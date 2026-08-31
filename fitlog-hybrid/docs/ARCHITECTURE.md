# 아키텍처

## 한 문장

**웹은 보이는 것을, 네이티브는 안 보일 때를 맡습니다.**

## 왜 이런 앱이 필요한가

FitLog 의 휴식 타이머는 이미 잘 만들어져 있습니다. 끝나는 '시각' 을 저장해
두기 때문에 앱을 껐다 켜도 남은 시간이 정확하고, 서비스워커 알림에 종료
시각까지 적어 둡니다.

딱 하나 못 하는 게 있습니다. **정확히 그 시각에 소리를 내는 것.**
브라우저는 화면 밖으로 나간 페이지를 다시 깨워 주지 않습니다. 90초 뒤에
알람을 울리려면 그 90초 동안 누군가 깨어 있거나, OS 에 예약해 두어야 합니다.
예약은 네이티브 코드만 할 수 있습니다.

그래서 이 앱은 웹앱을 다시 만들지 않습니다. 웹앱을 그대로 넣고, 예약 기능
하나를 옆에 붙입니다.

## 계약: 주고받는 것은 '끝나는 시각' 하나

```
사용자가 세트를 체크
        ↓
app.js  startRestTimer(90)
        ├─ state.restTimer = { endsAt: now + 90000, ... }   ← 화면용
        └─ FitLogNative.startRest({ endsAt, duration, label })
                ↓
        iOS : UNTimeIntervalNotificationTrigger 예약 + UserDefaults 저장
        And.: AlarmManager.setAlarmClock 예약 + SharedPreferences 저장
                ↓
        ┌───────────────┴───────────────┐
   앱이 떠 있음                      앱이 꺼져 있음
   웹이 매 250ms 남은 시간 그림      아무도 아무 일도 안 함
        └───────────────┬───────────────┘
                        ↓ endsAt 도달
        앱이 떠 있으면 → 웹이 소리·진동, 네이티브 알림은 숨김
        앱이 꺼져 있으면 → OS 가 알림을 띄움 (앱 실행 여부 무관)
```

핵심은 **남은 초를 주고받지 않는다**는 것입니다. 양쪽 모두 같은 `endsAt`
(epoch 밀리초) 하나만 보므로, 화면이 꺼져 있던 30초든 앱이 죽어 있던 5분이든
계산 결과가 어긋날 수가 없습니다. 동기화 코드가 아예 필요 없습니다.

`+15초` 도 같은 원리입니다 — `endsAt` 을 옮기고 예약을 다시 겁니다.

## 브릿지 규약

웹 쪽 구현: `fitlog-main/native-bridge.js`

### 웹 → 네이티브

| 호출 | 인자 | 하는 일 |
|---|---|---|
| `startRest(rt)` | `{endsAt, duration, label, setId}` | 예약 + 저장 |
| `updateRest(rt)` | 같음 | 예약을 새 시각으로 교체 |
| `stopRest()` | — | 예약 취소 + 저장 삭제 + 알림 제거 |
| `requestNotificationPermission()` | — | 알림 권한 요청 |
| `pending()` | — | 아직 안 끝난 휴식 (없으면 `null`) |

전송 방식이 플랫폼마다 다릅니다.

- **iOS**: `window.webkit.messageHandlers.fitlog.postMessage({action, ...})`
  — 메시지 핸들러 하나로 모두 받습니다. 단방향이라 값을 돌려받을 수 없어서,
  `pending()` 은 아래 방식으로 처리합니다.
- **Android**: `window.FitLogAndroid.startRest(jsonString)` 처럼 이름별 메서드.
  **인자는 반드시 JSON 문자열**입니다 — 자바스크립트 숫자를 `int` 로 받으면
  `endsAt`(1.7조)이 조용히 잘립니다.

### 네이티브 → 웹

| 호출 | 언제 |
|---|---|
| `FitLogNative._finished()` | 예약한 시각이 되었을 때 |
| `FitLogNative._cancelled()` | 사용자가 알림에서 휴식을 껐을 때 (Android) |

`_finished()` 는 사실 없어도 화면은 맞습니다(웹이 매 250ms `endsAt` 을 다시
재니까요). 알림을 눌러 앱이 막 깨어난 순간 화면을 즉시 맞추기 위한
것입니다. 반대로 `_cancelled()` 는 반드시 필요합니다 — 네이티브 알림에서 끈
휴식이 웹 화면에만 계속 떠 있으면 안 됩니다.

핸들러가 아직 안 꽂힌 시점(스크립트 로딩 전에 알림을 눌러 들어온 경우)에
도착한 호출은 브릿지가 큐에 담아 두었다가 넘깁니다.

### 앱을 다시 열었을 때 (`pending`)

앱이 죽어 있는 동안에도 계속 돌던 쪽은 네이티브입니다. 그래서
`restoreRestTimer()` 는 `localStorage` 보다 네이티브를 먼저 봅니다.

- **Android**: `pendingRest()` 를 동기 호출로 물어봅니다.
- **iOS**: 동기 응답이 불가능하므로, 네이티브가 페이지 스크립트보다 **먼저**
  (`WKUserScript`, `atDocumentStart`) `window.__fitlogNativeRest` 에 값을
  꽂아 둡니다. `native-bridge.js` 가 그 변수를 읽습니다.

## Android: 왜 포그라운드 서비스가 아닌가

원래 기획은 `ForegroundService` 안에서 1초씩 세는 방식이었습니다. 실제로
만들면 세 가지가 걸립니다.

1. **Android 14 의 서비스 종류 제한.** 포그라운드 서비스는 종류를 선언해야
   하고, 타이머에 맞는 `shortService` 는 3분 제한입니다. 휴식 180초에 `+15` 를
   몇 번 누르면 바로 넘어갑니다. `specialUse` 는 Play 심사에서 사유를
   요구합니다.
2. **1초마다 알림 갱신은 비쌉니다.** 배터리를 먹고, 기기에 따라 알림이
   깜빡입니다.
3. **서비스는 죽습니다.** 메모리가 빠듯하면 시스템이 정리합니다.

그래서 '세는 일' 과 '울리는 일' 을 나눴습니다.

- **세는 일 → 알림 자신에게.** `setWhen(endsAt)` +
  `setUsesChronometer(true)` + `setChronometerCountDown(true)` 를 켜면
  **시스템이** 남은 시간을 1초씩 줄여 그려 줍니다. 우리 프로세스는 그동안 단
  한 번도 깨어나지 않습니다.
- **울리는 일 → `AlarmManager.setAlarmClock()` 하나.** 특별 권한이 필요
  없고(`SCHEDULE_EXACT_ALARM` 선언 안 함), 절전 모드에서도 정확히 그 시각에
  기기를 깨웁니다. 앱이 완전히 닫혀 있어도 시스템이 `RestAlarmReceiver` 만
  따로 살려 줍니다.

대가는 하나: 휴식 중에 상태표시줄에 알람 아이콘이 뜹니다. 타이머 앱으로서는
오히려 자연스럽습니다.

## Android: 로컬 파일을 '진짜 도메인' 으로

```kotlin
WebViewAssetLoader.Builder()
    .setDomain("fitlog-4fe54.web.app")   // ← 이 한 줄
    .addPathHandler("/", LocalWebHandler(ctx))
    .build()
```

APK 안 `assets/web/` 의 파일을 `https://fitlog-4fe54.web.app/...` 로 내놓습니다.
브라우저 입장에서 출처는 그냥 그 사이트입니다. 그래서

- `localStorage` / IndexedDB 가 웹에서 쓰던 것과 **같은 칸**을 가리키고
- Firebase 의 "승인된 도메인" 검사를 통과하고
- `/__/auth/handler` 왕복이 같은 출처 안에서 끝납니다.

로컬에 없는 것(`/__/` 인증 핸들러, Firestore API, 안 받은 그림)은 핸들러가
`null` 을 돌려주고, 그러면 웹뷰가 평소대로 네트워크로 갑니다. **"로컬 번들 +
원격 폴백" 이 이 구조로 자연히 나옵니다.**

서비스워커가 보내는 요청도 같은 로더를 통과시킵니다
(`ServiceWorkerControllerCompat`). 이걸 빼면 화면은 뜨는데 서비스워커가 캐시를
채우려는 요청만 네트워크로 새어 나갑니다.

## iOS: 왜 원격 출처인가

`WKURLSchemeHandler` 는 `https` 를 가로챌 수 없습니다(애플이 막았습니다).
번들을 쓰려면 `file://` 이나 `fitlog://` 같은 **다른 출처**여야 하는데, 그러면

- 웹에서 쓰던 `localStorage` 가 다른 칸이 됩니다 → "기록이 다 사라졌다"
- Firebase 승인 도메인 검사에 걸립니다 → 구글 로그인 차단
- 인증 왕복이 서드파티 출처가 됩니다 → 로그인은 됐는데 화면은 그대로

셋 다 타이머보다 훨씬 큰 문제입니다. 그래서 iOS 는 원격으로 띄우고,
오프라인은 이미 있는 서비스워커에 맡깁니다(WKWebView 는 서비스워커를
지원합니다). 한 번이라도 앱을 연 뒤에는 비행기 모드에서도 뜹니다. 정말 한
번도 못 연 상태에서 네트워크가 없을 때만 네이티브 재시도 화면이 나옵니다.

## 웹 쪽에서 바뀐 곳

`fitlog-main` 에서 손댄 곳은 다음이 전부입니다.

| 파일 | 변경 |
|---|---|
| `native-bridge.js` | **새 파일.** 브릿지 전부 |
| `index.html` | `native-bridge.js` 를 `app.js` 보다 먼저 로드, `?v=69` |
| `sw.js` | 캐시 버전 `v69`, 프리캐시 목록에 새 파일 추가 |
| `app.js` `restoreRestTimer` | 네이티브의 타이머를 먼저 봄 |
| `app.js` `showRestNotification` | 네이티브가 있으면 웹 알림을 띄우지 않음 |
| `app.js` `startRestTimer` | 네이티브에 예약을 넘기고 손을 뗌 |
| `app.js` `adjustRestTimer` | ±15 를 네이티브 예약에도 반영 |
| `app.js` `cancelRestTimer` | 네이티브 예약도 취소 |
| `app.js` `startRestTicker` | 네이티브 → 웹 콜백 연결 |

브라우저에서 열면 `FitLogNative.ok === false` 라 이 분기들이 전부 지나가고,
PWA 는 지금까지와 완전히 똑같이 동작합니다.
