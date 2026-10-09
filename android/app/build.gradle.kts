plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Signing and versioning come from the environment (CI), mirroring ntfy-android's kc-release:
// KC_KEYSTORE_FILE / KC_KEYSTORE_PASSWORD / KC_KEY_ALIAS / KC_KEY_PASSWORD, KC_VERSION_NAME / KC_VERSION_CODE.
// Without KC_KEYSTORE_FILE the release build stays unsigned.
val keystoreFile: String? = System.getenv("KC_KEYSTORE_FILE")

android {
    namespace = "com.kudcrafts.kudmascot"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.kudcrafts.kudmascot"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("KC_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("KC_VERSION_NAME") ?: "1.0.0-dev"
    }

    signingConfigs {
        create("kudcrafts") {
            if (keystoreFile != null) {
                storeFile = file(keystoreFile)
                storeType = "pkcs12"
                storePassword = System.getenv("KC_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KC_KEY_ALIAS")
                keyPassword = System.getenv("KC_KEY_PASSWORD") ?: System.getenv("KC_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // No minify / resource shrinking: every icon drawable is looked up by name at runtime.
            isMinifyEnabled = false
            isShrinkResources = false
            if (keystoreFile != null) signingConfig = signingConfigs.getByName("kudcrafts")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    lint { checkReleaseBuilds = false }
    androidResources { noCompress += "png" }
}

dependencies {
    val bom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(bom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
