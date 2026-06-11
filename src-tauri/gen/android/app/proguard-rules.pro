# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# JNI bridge between Rust (src-tauri/src/notify.rs) and Kotlin.
# These members are reached only over JNI, so R8 sees no bytecode call sites
# and would strip/rename them in minified release builds — which silently
# breaks download notifications, status-bar theming and launch-intent handling.
# Keep them by exact name/signature.
# ---------------------------------------------------------------------------

# Rust -> Kotlin: DownloadNotifier.update(...) / cancel(...) called via JNI.
-keep class com.leaflet.reader.DownloadNotifier { *; }

# Rust -> Kotlin: MainActivity.setBarAppearance(...) (static) and the static
# pendingLaunchIntent field, both accessed via JNI. (The class itself is kept
# by the manifest; only its JNI-touched members need pinning.)
-keepclassmembers class com.leaflet.reader.MainActivity {
    public static void setBarAppearance(android.app.Activity, boolean);
    static java.lang.String pendingLaunchIntent;
}

# Kotlin -> Rust: native method invoked from MainActivity.onCreate to bootstrap
# ndk_context (also covered by the default native-methods rule; explicit here).
-keepclasseswithmembernames class com.leaflet.reader.MainActivity {
    native <methods>;
}
