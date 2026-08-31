import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* 서명 정보는 저장소에 넣지 않습니다. keystore.properties 가 있으면 릴리스
   빌드에 서명하고, 없으면(다른 사람이 클론했거나 CI 가 아직 비밀값을 못 받은
   경우) 서명 설정 없이 그냥 빌드합니다 — "파일이 없다" 로 빌드가 통째로
   깨지는 것보다 낫습니다. 형식은 android/keystore.properties.example 참고. */
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.fitlog.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.fitlog.app"
        /* 24 입니다(21 아님). 휴식 알림이 남은 시간을 스스로 세어 주는
           setChronometerCountDown 이 API 24 부터입니다. 그 아래에서는 1초마다
           알림을 다시 그려야 하는데, 그건 배터리도 먹고 알림이 계속 새로 뜬
           것처럼 깜빡입니다. 24 미만 점유율은 이제 1% 아래입니다. */
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    /* MainActivity 가 BuildConfig.DEBUG 를 봅니다(웹뷰 원격 디버깅을 디버그
       빌드에서만 켜려고). AGP 8 부터는 이 스위치가 기본 꺼짐입니다. */
    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystoreProps.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    /* 웹 자산(.js/.css/.svg)은 압축하지 않습니다. 압축해 두면 웹뷰가 요청할
       때마다 풀어야 해서 첫 화면이 오히려 느려집니다. APK 는 조금 커집니다. */
    androidResources {
        noCompress += listOf("svg", "webp")
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}")
    }
}

/* keystoreProps 가 비어 있으면 release 빌드는 "성공" 하지만 서명 없이
   나옵니다. 미서명 APK/AAB 는 Play Console 업로드가 그 자리에서 거부되므로
   실제로는 실패인데, 로그를 안 보면 성공으로 착각하기 쉽습니다. 빌드 자체를
   깨뜨리진 않되(CI 가 아직 비밀값을 못 받은 정상적인 경우도 있으므로),
   release 계열 태스크를 실행할 때는 눈에 띄게 경고를 남깁니다. */
tasks.matching { it.name.startsWith("assembleRelease") || it.name.startsWith("bundleRelease") }
    .configureEach {
        doFirst {
            if (keystoreProps.isEmpty()) {
                logger.warn(
                    "\n" +
                    "⚠️  경고: keystore.properties 가 없어 이 release 빌드는 서명되지 않습니다.\n" +
                    "   이 산출물은 Google Play Console 에 업로드할 수 없습니다.\n" +
                    "   android/keystore.properties.example 을 참고해 keystore.properties 를 채워주세요.\n"
                )
            }
        }
    }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    /* WebViewAssetLoader / ServiceWorkerControllerCompat 가 여기 있습니다.
       이 둘이 이 앱에서 웹뷰가 로컬 파일을 '진짜 도메인' 으로 읽게 해 주는
       핵심입니다 — 자세한 이유는 MainActivity 주석에 적어 두었습니다. */
    implementation("androidx.webkit:webkit:1.11.0")
}
