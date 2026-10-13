import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.monytix.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.monytix.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        val local = Properties()
        val localFile = rootProject.file("local.properties")
        if (localFile.exists()) {
            localFile.inputStream().use { local.load(it) }
        }
        val apiBase = local.getProperty("monytix.apiBaseUrl") ?: ""
        buildConfigField("String", "API_BASE_URL", "\"${apiBase.replace("\"", "")}\"")
        buildConfigField("boolean", "FIREBASE_CONFIGURED", file("google-services.json").exists().toString())
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        if (file("google-services.json").exists()) {
            getByName("main").java.srcDir("src/firebase/java")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    kotlinOptions {
        jvmTarget = "21"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    if (file("google-services.json").exists()) {
        implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
        implementation("com.google.firebase:firebase-auth")
        implementation("com.google.android.gms:play-services-auth:21.3.0")
    }
    debugImplementation("androidx.compose.ui:ui-tooling")
}

if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}
