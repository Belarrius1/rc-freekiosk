package com.freekiosk

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * Non-exportable device identity used only by Relic Commander's Terminal login.
 * The private key never crosses the React Native bridge and has no software fallback.
 */
class RcTerminalAuthModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "rc_terminal_login_v1"
    }

    override fun getName(): String = "RcTerminalAuthModule"

    override fun getConstants(): MutableMap<String, Any> = mutableMapOf(
        "KEY_ALIAS" to KEY_ALIAS,
        "APP_VERSION" to BuildConfig.VERSION_NAME,
    )

    @ReactMethod
    fun ensureKey(promise: Promise) {
        try {
            val keyStore = loadKeyStore()
            var publicKey = getValidPublicKey(keyStore)
            if (publicKey == null) {
                if (keyStore.containsAlias(KEY_ALIAS)) {
                    keyStore.deleteEntry(KEY_ALIAS)
                }
                generateKeyPair()
                publicKey = getValidPublicKey(loadKeyStore())
            }
            val verifiedPublicKey = publicKey
                ?: throw IllegalStateException("Android Keystore did not return a P-256 public key")
            promise.resolve(toPem(verifiedPublicKey.encoded))
        } catch (error: Exception) {
            promise.reject("KEYSTORE_UNAVAILABLE", "Unable to create the Terminal device identity", error)
        }
    }

    @ReactMethod
    fun hasKey(promise: Promise) {
        try {
            val keyStore = loadKeyStore()
            promise.resolve(
                keyStore.getKey(KEY_ALIAS, null) is PrivateKey &&
                    getValidPublicKey(keyStore) != null,
            )
        } catch (error: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun sign(message: String, promise: Promise) {
        if (message.isEmpty() || message.length > 4096) {
            promise.reject("INVALID_MESSAGE", "Terminal signature message is invalid")
            return
        }

        try {
            val privateKey = loadKeyStore().getKey(KEY_ALIAS, null) as? PrivateKey
                ?: throw IllegalStateException("Terminal key is missing")
            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initSign(privateKey)
            signature.update(message.toByteArray(Charsets.UTF_8))
            val derSignature = signature.sign()
            try {
                promise.resolve(Base64.encodeToString(derSignature, Base64.NO_WRAP))
            } finally {
                derSignature.fill(0)
            }
        } catch (error: Exception) {
            promise.reject("SIGNATURE_FAILED", "Unable to sign the Terminal challenge", error)
        }
    }

    @ReactMethod
    fun deleteKey(promise: Promise) {
        try {
            val keyStore = loadKeyStore()
            if (keyStore.containsAlias(KEY_ALIAS)) {
                keyStore.deleteEntry(KEY_ALIAS)
            }
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("KEY_DELETE_FAILED", "Unable to reset the Terminal device identity", error)
        }
    }

    private fun loadKeyStore(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply {
        load(null)
    }

    private fun generateKeyPair() {
        val generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            ANDROID_KEYSTORE,
        )
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_SIGN,
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setUserAuthenticationRequired(false)
            .build()
        generator.initialize(spec)
        generator.generateKeyPair()
    }

    private fun getValidPublicKey(keyStore: KeyStore): ECPublicKey? {
        val publicKey = keyStore.getCertificate(KEY_ALIAS)?.publicKey as? ECPublicKey
            ?: return null
        return publicKey.takeIf { it.params.curve.field.fieldSize == 256 }
    }

    private fun toPem(encoded: ByteArray): String {
        val base64 = Base64.encodeToString(encoded, Base64.NO_WRAP)
        val body = base64.chunked(64).joinToString("\n")
        return "-----BEGIN PUBLIC KEY-----\n$body\n-----END PUBLIC KEY-----\n"
    }
}
