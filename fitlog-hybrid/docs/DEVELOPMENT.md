# 개발 · 빌드 · 배포

## 필요한 것

| | Android | iOS |
|---|---|---|
| 도구 | Android Studio (Koala 이상) | Xcode 15+ (**맥 필요**) |
| SDK | compileSdk 34, minSdk 24 | iOS 15.0+ |
| 계정 | Google Play 개발자 $25 (1회) | Apple Developer $99/년 |
| 언어 | Kotlin, JDK 17 | Swift 5 |

지금 이 PC 는 Windows 라 **Android 는 바로 되고, iOS 는 맥에서 열어야
합니다.** iOS 프로젝트는 완성되어 있으니 맥에 옮겨 열기만 하면 됩니다.

## Android

### 처음 한 번

```powershell
cd fitlog-hybrid
powershell -ExecutionPolicy Bypass -File scripts\sync-web.ps1
```

그다음 Android Studio 로 `fitlog-hybrid\android` 를 엽니다. Gradle 래퍼 JAR 은
저장소에 없으므로(바이너리라 넣지 않았습니다) Android Studio 가 처음 열 때
자동으로 만들어 줍니다. 커맨드라인만 쓰고 싶다면 Gradle 8.7 을 설치한 뒤
`gradle wrapper` 를 한 번 실행하세요.

### 빌드

```powershell
cd android
.\gradlew assembleDebug          # 테스트용 APK
.\gradlew bundleRelease          # Play Store 용 AAB (서명 설정 필요)
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

### 서명 (Play Store 배포용)

```powershell
keytool -genkey -v -keystore fitlog-release.jks -keyalg RSA -keysize 2048 `
  -validity 10000 -alias fitlog
```

`android\keystore.properties.example` 을 `keystore.properties` 로 복사해
채웁니다. 이 파일과 `.jks` 는 `.gitignore` 에 이미 들어 있습니다.

> **키를 잃으면 끝입니다.** 같은 앱으로 업데이트를 올릴 수 없습니다.
> 비밀번호 관리자나 별도 백업에 반드시 보관하세요.
> (Play App Signing 에 등록해 두면 구글이 원본 키를 보관해 줍니다 — 권장.)

### 웹을 고쳤을 때

`scripts\sync-web.ps1` 을 다시 돌리고 재빌드해야 APK 안의 화면이 바뀝니다.
`assets/web` 은 `.gitignore` 대상이라 저장소에는 안 들어갑니다 — 원본은
`fitlog-main` 하나뿐입니다.

## iOS

```bash
open fitlog-hybrid/ios/FitLog.xcodeproj
```

1. `FitLog` 타깃 → **Signing & Capabilities** → Team 선택
   (Bundle Identifier `com.fitlog.app` 는 이미 들어 있습니다)
2. 시뮬레이터에서 Run → 화면이 뜨는지 확인
3. **실기기에서 Run** → 여기서부터가 진짜 테스트입니다.
   시뮬레이터는 백그라운드 동작과 알림 타이밍을 제대로 재현하지 못합니다.

프로젝트 파일이 Xcode 버전 문제로 열리지 않으면 XcodeGen 으로 다시 만들 수
있습니다.

```bash
brew install xcodegen
cd ios && xcodegen generate
```

### Archive → App Store

```
Product → Destination → Any iOS Device
Product → Archive
Organizer → Validate App → Distribute App → App Store Connect
```

## 버전 올리기

한 번에 네 곳을 맞춥니다. 하나라도 빠지면 사용자가 옛 화면을 보게 됩니다.

| 곳 | 값 |
|---|---|
| `fitlog-main/index.html` | `BUILD = "70"`, 모든 `?v=70` |
| `fitlog-main/sw.js` | `CACHE = "fitlog-v70"`, 프리캐시 목록의 `?v=70` |
| `android/app/build.gradle.kts` | `versionCode` +1, `versionName` |
| `ios` 빌드 설정 | `CURRENT_PROJECT_VERSION` +1, `MARKETING_VERSION` |

## 구글 로그인 — 확인하고 넘어가야 할 것

구글은 **정책상 앱 내장 웹뷰에서의 OAuth 로그인을 차단합니다**
(`403: disallowed_useragent`). 아이디/비밀번호 로그인은 영향이 없습니다.

이 앱은 로그인 코드를 건드리지 않았습니다. 먼저 실기기에서 구글 로그인이
되는지 확인하세요.

**막힌다면** 권장 방법은 이렇습니다 (웹뷰의 User-Agent 에서 `wv` 를 지우는
꼼수는 구글 정책 위반이고 결국 다시 막힙니다):

1. Google Cloud Console 에서 OAuth 클라이언트를 플랫폼별로 만듭니다
   (iOS 용 / Android 용, 둘 다 공개 클라이언트 = 시크릿 없음).
2. 네이티브가 **시스템 브라우저**로 PKCE 흐름을 돌립니다.
   iOS 는 `ASWebAuthenticationSession`, Android 는 Custom Tabs.
   이건 진짜 사파리/크롬이라 구글이 허용합니다.
3. 받은 `id_token` 을 웹뷰로 넘깁니다.
4. 웹에서:
   ```js
   firebase.auth().signInWithCredential(
     firebase.auth.GoogleAuthProvider.credential(idToken)
   )
   ```
   Firebase 는 같은 GCP 프로젝트의 클라이언트가 발급한 id_token 을 받아
   줍니다.

`native-bridge.js` 는 이 흐름을 나중에 얹기 좋게 만들어져 있습니다 —
`send('signInGoogle')` 하나와 `_googleToken(idToken)` 콜백을 추가하고,
`cloud.js` 의 `signInGoogle()` 앞에 분기 한 줄을 넣으면 됩니다.

## 자주 걸리는 것들

**릴리스 빌드에서만 타이머가 안 돕니다.**
R8 이 `WebBridge` 의 메서드 이름을 바꾼 것입니다. `proguard-rules.pro` 에
규칙이 들어 있으니, 브릿지에 메서드를 추가했다면 그 파일도 확인하세요.

**앱은 뜨는데 화면이 하얗습니다 (Android).**
`assets/web/index.html` 이 없습니다 — `sync-web` 을 안 돌렸습니다.

**로그인은 되는데 화면이 로그인 상태로 안 바뀝니다.**
출처가 어긋난 것입니다. 웹뷰가 `https://fitlog-4fe54.web.app` 이 아닌 다른
주소를 보고 있지 않은지 확인하세요 (`Config.APP_HOST`).

**알림이 아예 안 옵니다.**
Android 13+ 는 알림이 런타임 권한입니다. 설정 → 앱 → FitLog → 알림 확인.
타이머(알람) 자체는 권한과 무관하게 정확히 돕니다 — 알림만 안 보입니다.

**Android 에서 알림은 오는데 시간이 몇 분씩 밀립니다.**
제조사 배터리 최적화입니다(삼성·샤오미·화웨이가 특히 공격적). 설정 → 배터리
→ FitLog → "제한 없음" 으로 두고 다시 테스트하세요. `setAlarmClock` 은
이걸 대부분 뚫지만 전부는 아닙니다.

**웹뷰 안을 들여다보고 싶습니다.**
Android: 크롬에서 `chrome://inspect` (디버그 빌드에서만 켜 두었습니다).
iOS: Safari → 개발자 메뉴 → 기기 이름.

## 앱스토어 심사 메모

두 스토어 모두 "웹사이트를 그냥 감싼 앱" 을 거절합니다. 심사 노트에 이렇게
적으세요.

> 이 앱은 웹뷰로 UI 를 그리지만, 핵심 기능인 세트 간 휴식 타이머는 네이티브로
> 구현되어 있습니다. 앱이 백그라운드에 있거나 완전히 종료된 상태에서도
> 정확한 시각에 로컬 알림이 발생합니다(iOS:
> UNTimeIntervalNotificationTrigger, Android: AlarmManager + 카운트다운
> 알림). 웹만으로는 불가능한 동작입니다.
>
> 확인 방법: 운동 화면에서 세트를 체크 → 휴식 타이머 시작 → 홈 버튼으로 앱을
> 나가거나 종료 → 설정한 시간 뒤 알림이 도착합니다.

`store/` 안에 아이콘이 들어 있습니다.
- `play-icon-512.png` — Play Console 앱 아이콘 (512×512, 알파 없음)
- `appstore-icon-1024.png` — App Store 아이콘 (1024×1024, 알파 없음)

피처 그래픽(1024×500)과 스크린샷은 따로 준비해야 합니다.
