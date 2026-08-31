import Foundation

/// 껍데기가 알아야 하는 값 전부.
///
/// ── iOS 는 왜 안드로이드처럼 로컬 번들이 아닌가 ──────────────────────────
/// 안드로이드 쪽은 APK 안의 파일을 `https://fitlog-4fe54.web.app` 이라는
/// **진짜 도메인 이름으로** 내놓을 수 있습니다(WebViewAssetLoader). 그래서
/// 로컬 파일을 쓰면서도 출처가 웹과 같고, localStorage 도 파이어베이스
/// 로그인도 그대로 돌아갑니다.
///
/// iOS 에는 그에 해당하는 장치가 없습니다. WKWebView 의 커스텀 스킴 핸들러는
/// https 를 가로챌 수 없고(애플이 막아 두었습니다), 그래서 번들을 쓰려면
/// `file://` 나 `fitlog://` 같은 **다른 출처**로 띄워야 합니다. 그러면
///   · 웹에서 쓰던 localStorage / IndexedDB 가 통째로 다른 칸을 가리키고
///     (사용자에게는 "기록이 다 사라졌다" 로 보입니다)
///   · 파이어베이스 인증의 승인된 도메인 검사에 걸려 구글 로그인이 막히고
///   · /__/auth/handler 왕복이 서드파티 출처가 되어, 로그인은 끝났는데
///     화면은 그대로인 그 증상이 되돌아옵니다.
///
/// 그래서 iOS 는 원격 출처로 띄우고, 오프라인은 웹앱이 이미 가진
/// 서비스워커 캐시가 담당합니다(WKWebView 는 서비스워커를 지원합니다).
/// 한 번이라도 앱을 연 적이 있으면 비행기 모드에서도 화면이 뜹니다.
/// 정말 한 번도 못 연 상태에서 네트워크가 없을 때만 네이티브 재시도 화면이
/// 나옵니다.
///
/// 중요한 건 이것입니다: **휴식 타이머는 이 결정과 아무 상관이 없습니다.**
/// 타이머는 처음부터 끝까지 네이티브(로컬 알림)라서 네트워크가 있든 없든,
/// 앱이 떠 있든 죽어 있든 정확히 그 시각에 울립니다.
enum Config {
    static let appHost = "fitlog-4fe54.web.app"
    static let startURL = URL(string: "https://\(appHost)/")!

    /// 웹뷰 안에서 끝나야 하는 호스트들. 로그인 왕복이 여기 걸립니다.
    /// 이 목록에 없는 링크는 사파리로 넘깁니다.
    static let inAppHosts: [String] = [
        appHost,
        "firebaseapp.com",
        "google.com",
        "googleapis.com",
        "gstatic.com",
        "googleusercontent.com",
    ]

    static func opensInApp(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return inAppHosts.contains { host == $0 || host.hasSuffix(".\($0)") }
    }
}
