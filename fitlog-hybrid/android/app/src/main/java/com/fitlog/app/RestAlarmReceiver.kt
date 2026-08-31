package com.fitlog.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 휴식이 끝나는 시각에 시스템이 깨우는 곳. 앱이 완전히 닫혀 있어도 이
 * 리시버만 따로 살아납니다 — 그게 웹앱이 할 수 없던 일이고, 이 앱을 굳이
 * 네이티브로 만드는 이유의 전부입니다.
 *
 * 여기서 오래 걸리는 일을 하면 안 됩니다(10초 넘으면 ANR). 알림 하나 띄우고
 * 끝냅니다.
 */
class RestAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_FIRE -> RestTimer.onFinished(context)
            ACTION_CANCEL -> RestTimer.cancelFromNotification(context)
        }
    }

    companion object {
        const val ACTION_FIRE = "com.fitlog.app.REST_FIRE"
        const val ACTION_CANCEL = "com.fitlog.app.REST_CANCEL"
    }
}
