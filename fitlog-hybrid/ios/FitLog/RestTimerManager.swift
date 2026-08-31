import Foundation
import UIKit
import UserNotifications

/// 휴식 타이머의 iOS 쪽 전부.
///
/// ── 왜 Timer 로 세지 않는가 ──────────────────────────────────────────────
/// iOS 는 화면 밖으로 나간 앱에게 CPU 를 주지 않습니다. `Timer` 는 앱이
/// 백그라운드로 가는 순간 멈추고, 잠금화면에서는 애초에 돌지 않습니다.
/// 그래서 "90초 뒤에 울려 줘" 를 우리가 직접 세면 안 되고, **OS 에 예약**해야
/// 합니다. 그게 `UNTimeIntervalNotificationTrigger` 입니다. 예약해 두면 앱을
/// 완전히 종료해도, 기기를 재부팅해도(예약은 살아남습니다) 그 시각에 울립니다.
///
/// 그래서 이 클래스가 하는 일은 세 줄입니다.
///   1. 끝나는 시각을 UserDefaults 에 적는다 (앱이 다시 뜰 때 되찾으려고)
///   2. 그 시각에 울릴 로컬 알림을 예약한다
///   3. 취소하면 둘 다 지운다
/// 남은 시간을 세는 일은 아무도 하지 않습니다. 화면이 켜져 있을 때의 카운트
/// 다운은 웹이 그리고, 화면이 꺼져 있을 때는 셀 필요가 없습니다.
final class RestTimerManager {

    struct Rest {
        let endsAt: Date
        let duration: Int
        let label: String
        let setId: String

        var dictionary: [String: Any] {
            [
                "endsAt": Int(endsAt.timeIntervalSince1970 * 1000),
                "duration": duration,
                "label": label,
                "setId": setId,
            ]
        }

        /// 웹이 보내온 메시지 본문에서. endsAt 은 epoch 밀리초입니다 —
        /// 남은 초가 아니라 '끝나는 시각' 을 주고받는 것이 이 설계의 핵심이라,
        /// 웹과 네이티브의 카운트다운이 어긋날 수가 없습니다.
        init?(message: [String: Any]) {
            guard let ms = (message["endsAt"] as? NSNumber)?.doubleValue, ms > 0 else { return nil }
            endsAt = Date(timeIntervalSince1970: ms / 1000)
            duration = max(1, (message["duration"] as? NSNumber)?.intValue ?? 0)
            label = (message["label"] as? String) ?? ""
            setId = (message["setId"] as? String) ?? ""
        }

        init?(stored: [String: Any]) {
            guard let ms = stored["endsAt"] as? Double, ms > 0 else { return nil }
            endsAt = Date(timeIntervalSince1970: ms / 1000)
            duration = max(1, (stored["duration"] as? Int) ?? 0)
            label = (stored["label"] as? String) ?? ""
            setId = (stored["setId"] as? String) ?? ""
        }

        var storable: [String: Any] {
            [
                "endsAt": endsAt.timeIntervalSince1970 * 1000,
                "duration": duration,
                "label": label,
                "setId": setId,
            ]
        }
    }

    static let shared = RestTimerManager()

    private let defaultsKey = "fitlog.rest"
    private let requestID = "fitlog.rest.done"
    private let center = UNUserNotificationCenter.current()

    private init() {}

    /// 아직 안 끝난 휴식. 지난 것은 없는 것으로 칩니다.
    var current: Rest? {
        guard
            let stored = UserDefaults.standard.dictionary(forKey: defaultsKey),
            let rest = Rest(stored: stored)
        else { return nil }
        if rest.endsAt <= Date() {
            clearStorage()
            return nil
        }
        return rest
    }

    // MARK: - 시작 / 변경 / 중지

    /// 시작과 ±15초가 같은 함수입니다. 끝나는 시각만 바뀌므로 알림을 지우고
    /// 다시 예약하면 그만입니다.
    func start(_ rest: Rest) {
        guard rest.endsAt > Date() else {
            stop()
            return
        }
        UserDefaults.standard.set(rest.storable, forKey: defaultsKey)
        scheduleNotification(for: rest)
    }

    func stop() {
        clearStorage()
        center.removePendingNotificationRequests(withIdentifiers: [requestID])
        center.removeDeliveredNotifications(withIdentifiers: [requestID])
    }

    /// 알림이 실제로 울렸거나, 앱이 뜰 때 이미 지난 휴식을 발견했을 때.
    func markFinished() {
        clearStorage()
    }

    private func clearStorage() {
        UserDefaults.standard.removeObject(forKey: defaultsKey)
    }

    // MARK: - 알림

    func requestAuthorization(_ completion: ((Bool) -> Void)? = nil) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async { completion?(granted) }
        }
    }

    private func scheduleNotification(for rest: Rest) {
        let interval = rest.endsAt.timeIntervalSinceNow
        /* UNTimeIntervalNotificationTrigger 는 0 이하를 받으면 예외를 던집니다.
           ±15 로 이미 지난 시각이 될 수 있으므로 바닥을 깔아 둡니다. */
        guard interval > 0.5 else {
            stop()
            return
        }

        let content = UNMutableNotificationContent()
        content.title = "휴식 완료"
        content.body = rest.label.isEmpty
            ? "다음 세트를 시작하세요 💪"
            : "\(rest.label) · 다음 세트를 시작하세요 💪"
        content.sound = .default
        /* 집중 모드(방해 금지)를 뚫고 나오게 합니다. 실제로 적용되려면
           "Time Sensitive Notifications" 자격(entitlement)이 필요합니다 —
           Xcode → Signing & Capabilities → + Capability 에서 추가하세요.
           없어도 크래시하지 않고 일반 알림으로 조용히 내려갑니다. */
        content.interruptionLevel = .timeSensitive
        content.categoryIdentifier = "FITLOG_REST"
        content.userInfo = ["kind": "rest-done"]

        let request = UNNotificationRequest(
            identifier: requestID,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
        )

        /* 같은 식별자로 다시 넣으면 이전 예약이 교체됩니다. 그래도 명시적으로
           지웁니다 — 교체 동작에 기대면 ±15 를 빠르게 여러 번 눌렀을 때
           예약이 두 개 남는 경우가 드물게 있습니다. */
        center.removePendingNotificationRequests(withIdentifiers: [requestID])
        center.add(request, withCompletionHandler: nil)
    }
}
