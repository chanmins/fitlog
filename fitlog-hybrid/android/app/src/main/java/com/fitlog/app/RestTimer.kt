package com.fitlog.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * 휴식 타이머의 네이티브 쪽 전부.
 *
 * ── 왜 포그라운드 서비스가 아닌가 ──────────────────────────────────────────
 * 처음 기획서는 ForegroundService 로 1초씩 세는 방식이었습니다. 실제로
 * 만들어 보면 그 방식은 요즘 안드로이드에서 세 가지가 걸립니다.
 *   1. Android 14 부터 포그라운드 서비스는 '종류' 를 선언해야 하고, 타이머에
 *      맞는 종류(shortService)는 3분 제한이 있습니다. 휴식 180초 + ±15 를
 *      몇 번 누르면 바로 넘어갑니다.
 *   2. 1초마다 알림을 다시 그리면 배터리 소모가 눈에 띄고, 기기에 따라 알림이
 *      깜빡입니다.
 *   3. 서비스가 살아 있어야만 정확한데, 메모리가 빠듯하면 시스템이 죽입니다.
 *
 * 그래서 '세는 일' 과 '울리는 일' 을 나눴습니다.
 *   · 세는 일  → 알림 자체에 맡깁니다. setChronometerCountDown 을 켜면
 *                 시스템이 끝나는 시각까지 남은 시간을 스스로 줄여 보여 줍니다.
 *                 우리 프로세스는 아무 일도 하지 않습니다.
 *   · 울리는 일 → AlarmManager.setAlarmClock 하나. 특별 권한이 필요 없고,
 *                 절전 모드에서도 정확히 그 시각에 기기를 깨웁니다. 앱이
 *                 완전히 닫혀 있어도 시스템이 리시버만 살려 줍니다.
 *
 * 남은 시간을 우리가 세지 않으므로, 이 객체가 들고 있는 상태는 '끝나는 시각'
 * 하나뿐입니다. 웹 쪽 상태(endsAt)와 정확히 같은 값이라 둘이 어긋날 수가
 * 없습니다.
 */
object RestTimer {

    data class Rest(
        val endsAt: Long,
        val duration: Int,
        val label: String,
        val setId: String,
    ) {
        fun toJson(): String = JSONObject()
            .put("endsAt", endsAt)
            .put("duration", duration)
            .put("label", label)
            .put("setId", setId)
            .toString()

        companion object {
            fun from(json: String?): Rest? {
                return try {
                    if (json == null) return null
                    val o = JSONObject(json)
                    val endsAt = o.optLong("endsAt", 0L)
                    if (endsAt <= 0L) null
                    else Rest(
                        endsAt = endsAt,
                        duration = o.optInt("duration", 0).coerceAtLeast(1),
                        label = o.optString("label", ""),
                        setId = o.optString("setId", ""),
                    )
                } catch (_: Exception) {
                    null
                }
            }
        }
    }

    private const val PREFS = "fitlog_native"
    private const val KEY_REST = "rest"

    const val CHANNEL_RUNNING = "rest_running"
    const val CHANNEL_DONE = "rest_done"

    private const val NOTI_RUNNING = 1001
    private const val NOTI_DONE = 1002

    private const val REQ_ALARM = 2001
    private const val REQ_CANCEL = 2002
    private const val REQ_OPEN = 2003

    /* ── 상태 ──────────────────────────────────────────────────────────── */

    /** 지금 돌아가는 휴식. 이미 지난 것은 없는 것으로 칩니다. */
    fun current(ctx: Context): Rest? {
        val rest = Rest.from(prefs(ctx).getString(KEY_REST, null)) ?: return null
        if (rest.endsAt <= System.currentTimeMillis()) {
            clear(ctx)
            return null
        }
        return rest
    }

    private fun prefs(ctx: Context) =
        ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun store(ctx: Context, rest: Rest?) {
        prefs(ctx).edit().apply {
            if (rest == null) remove(KEY_REST) else putString(KEY_REST, rest.toJson())
        }.apply()
    }

    private fun clear(ctx: Context) = store(ctx, null)

    /* ── 시작 / 변경 / 중지 ─────────────────────────────────────────────── */

    /**
     * [start] 는 '다시 시작' 도 겸합니다. ±15초로 끝나는 시각이 바뀌면 그냥
     * 같은 요청 코드로 알람을 다시 걸면 되고, 그러면 이전 알람은 시스템이
     * 알아서 교체합니다 — 따로 취소할 필요가 없습니다.
     */
    fun start(ctx: Context, rest: Rest) {
        val app = ctx.applicationContext
        if (rest.endsAt <= System.currentTimeMillis()) {
            stop(app)
            return
        }
        ensureChannels(app)
        store(app, rest)
        scheduleAlarm(app, rest)
        showRunningNotification(app, rest)
    }

    fun stop(ctx: Context) {
        val app = ctx.applicationContext
        cancelAlarm(app)
        clear(app)
        NotificationManagerCompat.from(app).cancel(NOTI_RUNNING)
    }

    /** 휴식 알림의 "끝내기" 를 눌렀을 때. 웹 화면도 같이 정리해야 합니다. */
    fun cancelFromNotification(ctx: Context) {
        stop(ctx)
        RestEvents.emit(RestEvents.CANCEL)
    }

    /** 예약해 둔 시각이 되어 리시버가 깨웠을 때. */
    fun onFinished(ctx: Context) {
        val app = ctx.applicationContext
        val rest = Rest.from(prefs(app).getString(KEY_REST, null))
        clear(app)
        val nm = NotificationManagerCompat.from(app)
        nm.cancel(NOTI_RUNNING)

        /* 앱을 보고 있는 중이라면 알림을 띄우지 않습니다. 화면에 이미 휴식 바가
           있고 웹이 소리와 진동을 냅니다. 여기서 또 띄우면 보고 있는 화면 위로
           같은 말을 하는 배너가 덮칩니다. */
        if (RestEvents.foreground) {
            RestEvents.emit(RestEvents.FINISH)
            return
        }

        val text = if (rest?.label.isNullOrBlank()) app.getString(R.string.rest_done_text)
                   else app.getString(R.string.rest_done_text_labeled, rest?.label)
        val noti = NotificationCompat.Builder(app, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_fitlog)
            .setContentTitle(app.getString(R.string.rest_done_title))
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent(app))
            .build()
        notifySafely(app, NOTI_DONE, noti)
        RestEvents.emit(RestEvents.FINISH)
    }

    /* ── 알람 ──────────────────────────────────────────────────────────── */

    private fun alarmPendingIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, RestAlarmReceiver::class.java).setAction(RestAlarmReceiver.ACTION_FIRE)
        return PendingIntent.getBroadcast(ctx, REQ_ALARM, intent, immutableUpdate())
    }

    private fun scheduleAlarm(ctx: Context, rest: Rest) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val info = AlarmManager.AlarmClockInfo(rest.endsAt, openAppIntent(ctx))
        try {
            /* setAlarmClock: 특별 권한 없이 쓸 수 있는 유일한 '정확한' 알람.
               사용자가 알람으로 인식하는 용도라 시스템이 절전 중에도 깨워
               줍니다. 대신 상태표시줄에 알람 아이콘이 하나 붙습니다. */
            am.setAlarmClock(info, alarmPendingIntent(ctx))
        } catch (_: SecurityException) {
            /* 제조사 커스텀 ROM 등에서 막혔을 때. 정확도는 떨어져도 안 울리는
               것보다는 낫습니다. */
            am.set(AlarmManager.RTC_WAKEUP, rest.endsAt, alarmPendingIntent(ctx))
        }
    }

    private fun cancelAlarm(ctx: Context) {
        val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(alarmPendingIntent(ctx))
    }

    /* ── 알림 ──────────────────────────────────────────────────────────── */

    fun ensureChannels(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = ctx.getSystemService(NotificationManager::class.java) ?: return

        /* 휴식 '중' 은 조용해야 합니다. 소리를 내면 세트마다 울립니다. */
        val running = NotificationChannel(
            CHANNEL_RUNNING,
            ctx.getString(R.string.channel_running),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = ctx.getString(R.string.channel_running_desc)
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }

        /* 휴식 '끝' 은 다른 앱을 보고 있어도 눈에 띄어야 하니 따로 둡니다.
           채널이 하나면 사용자가 "조용히" 로 바꾸는 순간 끝나는 알림도 같이
           조용해집니다. */
        val done = NotificationChannel(
            CHANNEL_DONE,
            ctx.getString(R.string.channel_done),
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = ctx.getString(R.string.channel_done_desc)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 120, 80, 120)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        nm.createNotificationChannel(running)
        nm.createNotificationChannel(done)
    }

    private fun showRunningNotification(ctx: Context, rest: Rest) {
        val cancel = PendingIntent.getBroadcast(
            ctx,
            REQ_CANCEL,
            Intent(ctx, RestAlarmReceiver::class.java).setAction(RestAlarmReceiver.ACTION_CANCEL),
            immutableUpdate(),
        )
        val noti = NotificationCompat.Builder(ctx, CHANNEL_RUNNING)
            .setSmallIcon(R.drawable.ic_stat_fitlog)
            .setContentTitle(ctx.getString(R.string.rest_running_title))
            .setContentText(rest.label.ifBlank { ctx.getString(R.string.rest_running_text) })
            /* 이 세 줄이 이 앱에서 제일 값싼 기능입니다. 시스템이 endsAt 까지
               남은 시간을 알아서 1초씩 줄여 그려 줍니다 — 우리 코드는 단 한
               번도 깨어나지 않습니다. */
            .setWhen(rest.endsAt)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setShowWhen(true)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppIntent(ctx))
            .addAction(0, ctx.getString(R.string.rest_stop_action), cancel)
            .build()
        notifySafely(ctx, NOTI_RUNNING, noti)
    }

    private fun openAppIntent(ctx: Context): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(ctx, REQ_OPEN, intent, immutableUpdate())
    }

    private fun immutableUpdate() =
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    /**
     * Android 13+ 에서 알림 권한이 없으면 notify() 가 SecurityException 을
     * 던집니다. 권한을 아직 안 준 사용자 때문에 앱이 죽으면 안 됩니다 —
     * 타이머 자체(알람)는 권한과 무관하게 계속 정확히 돕니다.
     */
    private fun notifySafely(ctx: Context, id: Int, noti: Notification) {
        try {
            NotificationManagerCompat.from(ctx).notify(id, noti)
        } catch (_: SecurityException) {
        }
    }
}

/**
 * 리시버(다른 프로세스 컴포넌트지만 같은 프로세스에서 돕니다)가 화면 쪽에
 * 소식을 전하는 통로. 액티비티가 살아 있으면 웹뷰에 전달되고, 없으면 그냥
 * 버려집니다 — 웹은 어차피 다음에 열릴 때 endsAt 을 다시 계산합니다.
 */
object RestEvents {
    const val FINISH = "finish"
    const val CANCEL = "cancel"

    @Volatile
    var listener: ((String) -> Unit)? = null

    /** 액티비티가 화면에 보이는 중인지. 끝 알림을 띄울지 말지를 여기서 봅니다. */
    @Volatile
    var foreground: Boolean = false

    fun emit(kind: String) {
        try { listener?.invoke(kind) } catch (_: Exception) {}
    }
}
