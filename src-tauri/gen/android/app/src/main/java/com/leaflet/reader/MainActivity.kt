package com.leaflet.reader

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Cold launch: stash any intent extra so consume_launch_intent
        // can drain it on frontend mount.
        intent?.let { rememberLaunchIntent(it) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Warm launch (singleTask): the running activity gets a new
        // intent (e.g., user tapped the notification while the app
        // was backgrounded). Update the stashed value so the frontend's
        // event listener fires the right side effect.
        rememberLaunchIntent(intent)
    }

    private fun rememberLaunchIntent(intent: Intent) {
        val extra = intent.getStringExtra("leaflet.open") ?: return
        pendingLaunchIntent = extra
    }

    companion object {
        /** Stashed launch-intent extra. Drained by Rust's
         *  consume_launch_intent. `@JvmField` emits a true static
         *  field (which JNI `GetStaticFieldID` expects); `@JvmStatic`
         *  would only generate accessor methods, not the field.
         *  `@Volatile` makes cross-thread reads see the latest write. */
        @JvmField
        @Volatile
        var pendingLaunchIntent: String? = null
    }
}
