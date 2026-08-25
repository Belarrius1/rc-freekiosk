package com.freekiosk

import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Kiosk-safe access to the Android screen-off timeout; never opens Android Settings. */
class ScreenTimeoutModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val MODULE_NAME = "ScreenTimeoutModule"
        private val ALLOWED_TIMEOUTS_MS = setOf(
            30_000L,
            60_000L,
            120_000L,
            300_000L,
            600_000L,
        )
    }

    override fun getName(): String = MODULE_NAME

    @ReactMethod
    fun isAvailable(promise: Promise) {
        promise.resolve(canWriteSystemSettings())
    }

    @ReactMethod
    fun getTimeout(promise: Promise) {
        try {
            val timeout = Settings.System.getLong(
                reactContext.contentResolver,
                Settings.System.SCREEN_OFF_TIMEOUT,
                60_000L,
            )
            promise.resolve(timeout.toDouble())
        } catch (error: Exception) {
            promise.reject("SCREEN_TIMEOUT_READ_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun setTimeout(timeoutMs: Double, promise: Promise) {
        val timeout = timeoutMs.toLong()
        if (timeout !in ALLOWED_TIMEOUTS_MS) {
            promise.reject("INVALID_SCREEN_TIMEOUT", "Unsupported screen timeout")
            return
        }
        if (!canWriteSystemSettings()) {
            promise.reject(
                "SCREEN_TIMEOUT_PERMISSION_DENIED",
                "Screen timeout cannot be changed on this device",
            )
            return
        }

        try {
            val changed = Settings.System.putLong(
                reactContext.contentResolver,
                Settings.System.SCREEN_OFF_TIMEOUT,
                timeout,
            )
            if (!changed) {
                promise.reject(
                    "SCREEN_TIMEOUT_WRITE_FAILED",
                    "Android rejected the screen timeout",
                )
                return
            }
            promise.resolve(timeout.toDouble())
        } catch (error: Exception) {
            promise.reject("SCREEN_TIMEOUT_WRITE_FAILED", error.message, error)
        }
    }

    private fun canWriteSystemSettings(): Boolean {
        if (Settings.System.canWrite(reactContext)) return true
        return reactContext.checkCallingOrSelfPermission(
            android.Manifest.permission.WRITE_SECURE_SETTINGS,
        ) == PackageManager.PERMISSION_GRANTED
    }
}
