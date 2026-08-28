package com.freekiosk

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/** Applies the RC Terminal Bluetooth default once, and only on a fresh installation. */
object BluetoothInstallDefault {
    private const val PREFS_NAME = "FreeKioskSettings"
    private const val KEY_EVALUATED = "bluetooth_install_default_evaluated_v1"

    @Synchronized
    fun applyIfEligible(context: Context) {
        val appContext = context.applicationContext
        val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_EVALUATED, false)) return

        // The marker does not exist yet on installations upgrading from an older APK.
        // Package timestamps let us preserve their current global Bluetooth state.
        if (!isFreshInstall(appContext)) {
            prefs.edit().putBoolean(KEY_EVALUATED, true).apply()
            DebugLog.d("BluetoothInstallDefault", "Upgrade detected; Bluetooth state preserved")
            return
        }

        val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        if (!dpm.isDeviceOwnerApp(appContext.packageName)) {
            // Provisioning may launch the application before Device Owner is active.
            // Leave the marker unset so the next activity launch can retry safely.
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.BLUETOOTH_CONNECT) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            // MainActivity grants this permission for Device Owner installations before retrying.
            return
        }

        val adapter = (appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
            ?.adapter
        if (adapter == null || !adapter.isEnabled) {
            prefs.edit().putBoolean(KEY_EVALUATED, true).apply()
            DebugLog.d("BluetoothInstallDefault", "Fresh install already has Bluetooth off")
            return
        }

        try {
            @Suppress("DEPRECATION")
            val accepted = adapter.disable()
            if (accepted) {
                prefs.edit().putBoolean(KEY_EVALUATED, true).apply()
                DebugLog.d("BluetoothInstallDefault", "Bluetooth disabled for fresh Device Owner install")
            } else {
                DebugLog.w("BluetoothInstallDefault", "Android rejected the initial Bluetooth disable request")
            }
        } catch (e: Exception) {
            // Do not set the marker: a later activity launch may succeed after provisioning.
            DebugLog.w("BluetoothInstallDefault", "Initial Bluetooth disable failed: ${e.javaClass.simpleName}")
        }
    }

    @Suppress("DEPRECATION")
    private fun isFreshInstall(context: Context): Boolean {
        return try {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            packageInfo.firstInstallTime == packageInfo.lastUpdateTime
        } catch (_: Exception) {
            // Preserve system state if installation history cannot be established.
            false
        }
    }
}
