package com.freekiosk

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.net.wifi.WifiManager
import android.os.PowerManager
import android.util.Log

/**
 * Experimental workaround for the RC Terminal tablet suspend failure.
 *
 * The affected Allwinner/AIC8800 firmware repeatedly reports rwnx_hostwake_irq and
 * platform suspend failures. This special build therefore powers the Wi-Fi radio down
 * before suspend and restores it when the device becomes interactive again.
 *
 * This deliberately lives in native code: React Native timers and callbacks are not
 * reliable after ACTION_SCREEN_OFF. The marker is kept in device-protected storage so a
 * reboot that happens while Wi-Fi is off can safely restore it before credential storage
 * is unlocked.
 */
object SleepWifiController {
    private const val TAG = "SleepWifiController"
    private const val PREFS_NAME = "rc_sleep_wifi_experiment"
    private const val KEY_DISABLED_FOR_SLEEP = "wifi_disabled_for_sleep"
    private const val TRANSITION_WAKE_LOCK_MS = 7_000L

    // This is intentionally enabled for the dedicated diagnostic build requested for
    // the affected RC Terminal. Remove or set to false after the A/B test is complete.
    private const val EXPERIMENT_ENABLED = true

    private var transitionWakeLock: PowerManager.WakeLock? = null

    @Synchronized
    fun onScreenOff(context: Context) {
        if (!EXPERIMENT_ENABLED || !isDeviceOwner(context)) return

        val prefs = prefs(context)
        if (prefs.getBoolean(KEY_DISABLED_FOR_SLEEP, false)) {
            // MainActivity and OverlayService can both observe the same screen event.
            // Only the first receiver is allowed to perform the transition.
            return
        }

        val wifiManager = wifiManager(context)
        if (!wifiManager.isWifiEnabled) {
            // Wi-Fi was already off by user choice; never claim ownership of that state.
            return
        }

        // Persist before touching the radio so boot recovery still works if the vendor
        // driver freezes during the asynchronous shutdown request.
        if (!prefs.edit().putBoolean(KEY_DISABLED_FOR_SLEEP, true).commit()) {
            Log.w(TAG, "Could not persist the sleep Wi-Fi recovery marker")
            return
        }

        acquireTransitionWakeLock(context)
        try {
            @Suppress("DEPRECATION")
            val accepted = wifiManager.setWifiEnabled(false)
            if (accepted) {
                Log.i(TAG, "Screen off: Wi-Fi disable requested for suspend experiment")
            } else {
                clearRecoveryMarker(context)
                releaseTransitionWakeLock()
                Log.w(TAG, "Screen off: Android rejected the Wi-Fi disable request")
            }
        } catch (e: Exception) {
            clearRecoveryMarker(context)
            releaseTransitionWakeLock()
            Log.w(TAG, "Screen off: Wi-Fi disable failed: ${e.javaClass.simpleName}")
        }
    }

    @Synchronized
    fun onScreenOn(context: Context) {
        if (!EXPERIMENT_ENABLED) return
        releaseTransitionWakeLock()
        restoreWifiIfNeeded(context, "screen on")
    }

    /** Restore Wi-Fi after a reboot, including LOCKED_BOOT_COMPLETED. */
    @Synchronized
    fun restoreAfterBoot(context: Context) {
        if (!EXPERIMENT_ENABLED) return
        releaseTransitionWakeLock()
        restoreWifiIfNeeded(context, "boot")
    }

    /**
     * Covers process/activity recreation while the display is already awake. Do not restore
     * from a background restart while the device remains asleep, since that would invalidate
     * the experiment before the next physical wake.
     */
    @Synchronized
    fun restoreIfInteractive(context: Context) {
        if (!EXPERIMENT_ENABLED) return
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (powerManager.isInteractive) {
            restoreWifiIfNeeded(context, "interactive app start")
        }
    }

    private fun restoreWifiIfNeeded(context: Context, reason: String) {
        val prefs = prefs(context)
        if (!prefs.getBoolean(KEY_DISABLED_FOR_SLEEP, false)) return

        if (!isDeviceOwner(context)) {
            Log.w(TAG, "$reason: cannot restore Wi-Fi because FreeKiosk is not Device Owner")
            return
        }

        val wifiManager = wifiManager(context)
        if (wifiManager.isWifiEnabled) {
            clearRecoveryMarker(context)
            Log.i(TAG, "$reason: Wi-Fi was already enabled; recovery marker cleared")
            return
        }

        try {
            @Suppress("DEPRECATION")
            val accepted = wifiManager.setWifiEnabled(true)
            if (accepted) {
                clearRecoveryMarker(context)
                Log.i(TAG, "$reason: Wi-Fi restore requested after sleep experiment")
            } else {
                Log.w(TAG, "$reason: Android rejected the Wi-Fi restore request; will retry")
            }
        } catch (e: Exception) {
            Log.w(TAG, "$reason: Wi-Fi restore failed: ${e.javaClass.simpleName}")
        }
    }

    private fun acquireTransitionWakeLock(context: Context) {
        releaseTransitionWakeLock()
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        transitionWakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "FreeKiosk:SleepWifiTransition",
        ).apply {
            setReferenceCounted(false)
            acquire(TRANSITION_WAKE_LOCK_MS)
        }
    }

    private fun releaseTransitionWakeLock() {
        try {
            transitionWakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
            // A timed WakeLock may expire between isHeld and release().
        } finally {
            transitionWakeLock = null
        }
    }

    private fun clearRecoveryMarker(context: Context) {
        prefs(context).edit().putBoolean(KEY_DISABLED_FOR_SLEEP, false).commit()
    }

    private fun prefs(context: Context) =
        context.createDeviceProtectedStorageContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private fun wifiManager(context: Context) =
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    private fun isDeviceOwner(context: Context): Boolean = try {
        val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        dpm.isDeviceOwnerApp(context.packageName)
    } catch (_: Exception) {
        false
    }
}
