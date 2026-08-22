package com.freekiosk

import android.app.WallpaperManager
import android.content.Context
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Log
import java.security.MessageDigest

/** Applies the packaged RC Terminal wallpaper without delaying app startup. */
object RcWallpaperInstaller {
    private const val TAG = "RcWallpaperInstaller"
    private const val ASSET_NAME = "rc-terminal-wallpaper.png"
    private const val PREFERENCES_NAME = "RcTerminalWallpaper"
    private const val HASH_KEY = "applied_asset_sha256"

    fun applyIfChanged(context: Context) {
        val appContext = context.applicationContext

        Thread({
            try {
                applyWallpaperIfChanged(appContext)
            } catch (error: Exception) {
                // Wallpaper support varies across OEM ROMs. Never prevent the kiosk
                // from starting if the system rejects or does not expose this feature.
                Log.w(TAG, "Unable to apply RC Terminal wallpaper: ${error.message}")
            }
        }, "rc-wallpaper-installer").start()
    }

    private fun applyWallpaperIfChanged(context: Context) {
        val imageBytes = context.assets.open(ASSET_NAME).use { it.readBytes() }
        val imageHash = MessageDigest.getInstance("SHA-256")
            .digest(imageBytes)
            .joinToString("") { byte -> "%02x".format(byte) }
        val preferences = context.getSharedPreferences(
            PREFERENCES_NAME,
            Context.MODE_PRIVATE,
        )

        if (preferences.getString(HASH_KEY, null) == imageHash) {
            return
        }

        val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
            ?: throw IllegalStateException("Unable to decode $ASSET_NAME")

        try {
            val wallpaperManager = WallpaperManager.getInstance(context)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                wallpaperManager.setBitmap(
                    bitmap,
                    null,
                    false,
                    WallpaperManager.FLAG_SYSTEM,
                )
            } else {
                @Suppress("DEPRECATION")
                wallpaperManager.setBitmap(bitmap)
            }

            preferences.edit().putString(HASH_KEY, imageHash).apply()
            Log.i(TAG, "RC Terminal system wallpaper applied")
        } finally {
            bitmap.recycle()
        }
    }
}
