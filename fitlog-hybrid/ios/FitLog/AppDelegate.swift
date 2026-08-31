import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?
    private var root: WebViewController?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self

        let vc = WebViewController()
        root = vc

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = vc
        window.backgroundColor = UIColor(red: 0x09/255, green: 0x09/255, blue: 0x0d/255, alpha: 1)
        window.makeKeyAndVisible()
        self.window = window

        /* 씬(Scene)을 쓰지 않습니다. 이 앱은 화면이 하나뿐이고 아이패드
           멀티윈도우도 지원하지 않아서, SceneDelegate 를 두면 파일만 늘고
           얻는 게 없습니다. Info.plist 에 UIApplicationSceneManifest 가
           없으면 iOS 는 이 방식으로 앱을 띄웁니다. */
        return true
    }

    // MARK: - 알림

    /// 앱을 보고 있는 중에 휴식이 끝났을 때. 배너를 띄우지 않습니다 —
    /// 화면에 이미 휴식 바가 있고 웹이 소리와 진동을 냅니다. 보고 있는 화면
    /// 위로 같은 말을 하는 배너가 덮이면 그게 더 거슬립니다.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        RestTimerManager.shared.markFinished()
        root?.notifyWeb("finish")
        completionHandler([])
    }

    /// 알림을 눌러서 앱이 열렸을 때(또는 앱이 아예 꺼져 있다가 이걸로 켜졌을 때).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        RestTimerManager.shared.markFinished()
        root?.notifyWeb("finish")
        completionHandler()
    }
}
