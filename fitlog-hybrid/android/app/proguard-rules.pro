# 자바스크립트가 이름으로 부르는 메서드입니다. R8 이 이름을 바꾸거나 지우면
# 웹에서 window.FitLogAndroid.startRest(...) 가 조용히 사라집니다 —
# 디버그 빌드에서는 멀쩡하고 릴리스에서만 타이머가 안 도는, 가장 찾기 어려운
# 종류의 버그입니다.
-keepclassmembers class com.fitlog.app.WebBridge {
    public *;
}
-keepattributes JavascriptInterface

# 알림/알람에서 이름으로 되살아나는 컴포넌트
-keep class com.fitlog.app.RestAlarmReceiver { *; }
