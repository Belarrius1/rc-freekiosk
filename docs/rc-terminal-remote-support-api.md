# API de supervision et d'assistance RC Terminal

Statut : **proposition d'architecture — version 1**

Ce document définit le contrat entre **RC-FreeKiosk**, installé sur les tablettes
Relic Commander Terminal, et le backend **Relic Commander**. Il doit servir de
référence commune aux développeurs Android et backend.

Cette API est distincte de l'API REST historique de FreeKiosk. L'API historique
ouvre un serveur HTTP sur la tablette et expose de nombreuses fonctions de
contrôle. Elle ne doit pas être activée sur les terminaux livrés aux joueurs.

## 1. Objectifs

Le service doit permettre de :

- connaître l'état technique minimal d'un terminal ;
- diagnostiquer une perte de connexion ou un manque de ressources ;
- recharger Relic Commander, redémarrer RC-FreeKiosk ou redémarrer Android ;
- connaître la version installée et déployer une mise à jour signée ;
- joindre volontairement une capture à un rapport d'assistance ;
- conserver une trace auditable de chaque action distante.

Il ne doit jamais permettre de :

- ouvrir une connexion entrante depuis Internet vers la tablette ;
- exécuter du JavaScript, une commande shell ou une saisie clavier distante ;
- changer librement l'URL du kiosque ou lancer une autre application ;
- utiliser la caméra, le microphone ou la localisation ;
- prendre une capture d'écran silencieusement ;
- récupérer un mot de passe Wi-Fi, des cookies, un token de jeu ou le PIN admin.

## 2. Architecture réseau

RC-FreeKiosk est toujours le client de la connexion :

```text
RC-FreeKiosk ── HTTPS sortant ──> API Relic Commander
```

Le terminal n'ouvre aucun port et reste joignable même derrière une box, un NAT
ou un pare-feu domestique. Le serveur REST historique de FreeKiosk reste
désactivé en production.

Base proposée :

```text
https://reliccommander.com/api/terminal/v1
```

Toutes les requêtes utilisent TLS. Le client refuse les redirections vers un
autre hôte et n'accepte jamais une URL `http://`.

## 3. Principes de confidentialité

### Données autorisées

| Catégorie | Données transmises |
|---|---|
| Identité | Identifiant aléatoire du terminal et liaison serveur au compte actif, jamais l'IMEI ou le numéro de série |
| Application | `versionName`, `versionCode`, identifiant de build |
| Plateforme | Version Android, modèle générique et version du WebView |
| Batterie | Pourcentage, charge en cours, batterie faible |
| Ressources | RAM libre/totale et stockage libre/total, arrondis au MiB |
| Réseau | Wi-Fi connecté, niveau de signal normalisé, Internet accessible |
| Jeu | Relic Commander accessible, dernier chargement réussi, erreur normalisée |
| Exécution | Durée depuis le démarrage, date du dernier contact |

### Données interdites

- SSID et BSSID du réseau domestique ;
- adresse IP publique ou locale, sauf nécessité technique documentée côté serveur ;
- coordonnées GPS ou autre donnée de localisation ;
- liste des réseaux Wi-Fi et appareils Bluetooth environnants ;
- nom des appareils Bluetooth associés ;
- mots de passe Wi-Fi, PIN administrateur et secrets d'authentification ;
- cookies, stockage WebView, contenu des formulaires ou URL contenant une query ;
- image caméra, flux audio ou enregistrement microphone ;
- capture d'écran sans action explicite de l'utilisateur.

Les journaux doivent employer des codes d'erreur stables. Ils ne doivent pas
contenir le contenu des pages, une URL complète, des en-têtes HTTP ou des
exceptions susceptibles d'inclure un secret.

## 4. Identité et authentification d'un terminal

### 4.1 Enrôlement

Le backend crée un jeton d'enrôlement aléatoire d'au moins 256 bits pour chaque
tablette. Le jeton est :

- unique à une tablette ;
- utilisable une seule fois ;
- valable au maximum 24 heures ;
- injecté lors du provisionnement local, idéalement par ADB ;
- supprimé de la tablette dès que l'enrôlement a réussi.

```http
POST /api/terminal/v1/enroll
Content-Type: application/json
```

```json
{
  "enrollment_token": "one-time-secret",
  "app_version": {
    "name": "1.1.0",
    "code": 11
  },
  "android_version": "15"
}
```

Réponse `201 Created` :

```json
{
  "terminal_id": "01JRC7M6Q2J8N6Q5ZV4K17A2N9",
  "device_token": "device-specific-secret",
  "heartbeat_interval_seconds": 300,
  "server_time": "2026-08-22T12:00:00Z"
}
```

`terminal_id` est un ULID ou UUID aléatoire, sans lien avec un identifiant
matériel. `device_token` contient au moins 256 bits d'entropie et est conservé
avec le stockage sécurisé Android utilisé par RC-FreeKiosk.

Le backend ne conserve qu'une empreinte résistante du token. Il doit permettre
sa révocation et sa rotation terminal par terminal.

La version 1 utilise un token propre au terminal. Une authentification par
certificat client généré et conservé dans l'Android Keystore pourra la remplacer
ultérieurement sans modifier le modèle d'autorisation serveur.

### 4.2 Requêtes authentifiées

```http
Authorization: Bearer <device_token>
X-RC-Terminal-ID: <terminal_id>
X-RC-Protocol-Version: 1
```

Le token n'est jamais placé dans une URL, un message d'erreur ou un journal. Le
serveur déduit l'identité autorisée du token et vérifie qu'elle correspond au
header `X-RC-Terminal-ID`.

Toutes les requêtes en base sont filtrées à partir de l'identité authentifiée,
jamais à partir du seul `{terminal_id}` fourni dans l'URL. Un terminal ne peut
lire ses commandes, publier un heartbeat, envoyer un résultat ou créer un upload
que pour lui-même. Il n'existe aucun secret global partagé par la flotte.

Réponses d'authentification :

- `401 Unauthorized` : token absent, invalide ou révoqué ;
- `403 Forbidden` : terminal désactivé ou action interdite ;
- `426 Upgrade Required` : version du protocole non prise en charge.

Après trois réponses `401`, le client cesse les tentatives rapides et applique
un backoff. Il ne doit jamais se ré-enrôler automatiquement avec un ancien jeton.

### 4.3 Liaison avec le compte Relic Commander actif

Le support peut afficher le compte Relic Commander actuellement utilisé sur un
terminal, mais RC-FreeKiosk ne doit ni lire les cookies, ni inspecter le DOM, ni
recevoir le token de session du joueur.

La liaison recommandée emploie un challenge à usage unique :

1. après authentification du joueur, le backend du jeu crée un challenge aléatoire
   lié à la session et au compte déjà authentifiés ;
2. la page transmet uniquement ce challenge au code natif RC-FreeKiosk via un
   message WebView strictement typé ;
3. RC-FreeKiosk envoie le challenge au endpoint ci-dessous en utilisant son propre
   `device_token`, qui ne quitte jamais la couche native ;
4. le backend consomme le challenge et associe le `terminal_id` au compte lié à
   la session ayant créé le challenge ;
5. le challenge devient immédiatement inutilisable.

```http
POST /api/terminal/v1/terminals/{terminal_id}/session-links
Authorization: Bearer <device_token>
Content-Type: application/json
```

```json
{
  "challenge": "single-use-256-bit-random-value"
}
```

Réponse `200 OK` :

```json
{
  "linked": true,
  "linked_at": "2026-08-22T12:03:00Z"
}
```

Le challenge expire après deux minutes, possède au moins 256 bits d'entropie et
est protégé par une contrainte d'unicité serveur. La réponse ne renvoie pas le nom,
l'adresse e-mail ou l'identifiant du compte à la tablette. Ces informations ne
sont visibles que dans la console d'assistance autorisée.

Le backend clôt la liaison active à la déconnexion ou à l'expiration de la
session de jeu. Il peut conserver un historique minimal `terminal`, `compte`,
`première utilisation`, `dernière utilisation` pour la sécurité et l'assistance,
selon la durée annoncée au joueur. Une valeur envoyée librement par JavaScript ne
doit jamais être considérée comme une preuve d'identité de compte.

## 5. Heartbeat et récupération des commandes

Le terminal envoie un heartbeat :

- au démarrage de RC-FreeKiosk ;
- toutes les 5 minutes par défaut ;
- après une modification significative d'état ;
- après l'exécution d'une commande.

Le serveur peut demander temporairement un intervalle de 15 secondes pendant
une session d'assistance. Hors assistance, il ne doit pas demander moins de 60
secondes.

```http
POST /api/terminal/v1/terminals/{terminal_id}/heartbeat
Authorization: Bearer <device_token>
Content-Type: application/json
```

```json
{
  "event_id": "01JRC8F1R0STQ6YQKQBH6Z0M90",
  "sent_at": "2026-08-22T12:05:00Z",
  "app": {
    "version_name": "1.1.0",
    "version_code": 11,
    "build_id": "d492bc1"
  },
  "platform": {
    "android_version": "15",
    "webview_version": "138.0.7204.179",
    "device_model": "Generic 10-inch tablet"
  },
  "battery": {
    "percent": 82,
    "charging": true,
    "low": false
  },
  "resources": {
    "memory_free_mib": 1180,
    "memory_total_mib": 3072,
    "storage_free_mib": 47216,
    "storage_total_mib": 65536
  },
  "connectivity": {
    "wifi_connected": true,
    "wifi_signal_level": 3,
    "internet_reachable": true,
    "relic_commander_reachable": true
  },
  "runtime": {
    "uptime_seconds": 86400,
    "last_game_load_at": "2026-08-22T12:04:48Z",
    "last_error_code": null
  }
}
```

`wifi_signal_level` est compris entre 0 et 4. Aucun SSID, BSSID ou scan brut ne
doit être inclus.

Réponse `200 OK` :

```json
{
  "server_time": "2026-08-22T12:05:01Z",
  "next_heartbeat_seconds": 300,
  "commands": [
    {
      "id": "01JRC8EQSJS5C52R1E66ZWQFC3",
      "type": "reload_game",
      "issued_at": "2026-08-22T12:04:50Z",
      "expires_at": "2026-08-22T12:14:50Z",
      "payload": {}
    }
  ]
}
```

Le serveur ne renvoie au maximum que 10 commandes en attente. La réponse doit
rester valable si le tableau `commands` est vide.

### Codes d'erreur du jeu

Valeurs initiales recommandées pour `last_error_code` :

- `network_offline` ;
- `dns_failure` ;
- `tls_failure` ;
- `http_4xx` ;
- `http_5xx` ;
- `webview_process_crashed` ;
- `page_load_timeout` ;
- `turnstile_unavailable` ;
- `unknown`.

Le code ne doit pas contenir l'URL, le corps HTTP ou une exception brute.

## 6. Commandes distantes

Liste fermée des commandes version 1 :

| Type | Effet | Consentement local |
|---|---|---|
| `reload_game` | Recharge l'URL Relic Commander configurée | Non |
| `restart_app` | Redémarre l'interface RC-FreeKiosk | Non |
| `reboot_device` | Redémarre Android en Device Owner | Non, mais action auditée |
| `check_update` | Recherche une version disponible | Non |
| `install_update` | Télécharge et installe une version précise | Non, déploiement contrôlé |
| `request_screenshot` | Propose une capture pour l'assistance | **Oui, obligatoire** |

Toute commande inconnue est rejetée. Il n'existe volontairement aucune commande
générique du type `execute`, `javascript`, `shell`, `navigate`, `launch_app`,
`keyboard` ou `camera`.

Chaque `id` de commande est généré côté serveur, globalement unique et contient
au moins 128 bits non prédictibles. Il tient lieu de nonce anti-rejeu : le serveur
ne le réutilise jamais et applique une contrainte d'unicité en base.

Avant exécution, RC-FreeKiosk :

1. valide le schéma et la date d'expiration ;
2. enregistre durablement l'identifiant de commande ;
3. refuse un identifiant déjà traité ;
4. accuse réception ;
5. exécute l'action puis envoie son résultat.

Cette persistance rend `reboot_device` et `install_update` idempotentes malgré
une coupure réseau ou un redémarrage.

### Résultat d'une commande

```http
POST /api/terminal/v1/terminals/{terminal_id}/commands/{command_id}/result
Authorization: Bearer <device_token>
Content-Type: application/json
```

```json
{
  "state": "succeeded",
  "reported_at": "2026-08-22T12:05:08Z",
  "result_code": "game_reloaded",
  "details": null
}
```

Valeurs de `state` : `accepted`, `running`, `succeeded`, `failed`, `rejected` ou
`expired`. `details` est un message technique nettoyé, sans données privées.

## 7. Mise à jour distante de RC-FreeKiosk

Une commande `install_update` possède un payload complet et immuable :

```json
{
  "version_name": "1.2.0",
  "version_code": 100123,
  "apk_url": "https://github.com/Belarrius1/rc-freekiosk/releases/download/v1.2.0/RC-FreeKiosk-v1.2.0.apk",
  "apk_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "apk_size_bytes": 73400320,
  "minimum_battery_percent": 40,
  "wifi_only": true
}
```

Le client doit vérifier avant installation :

- schéma HTTPS et hôte présent dans une allowlist compilée ;
- taille maximale et taille réellement téléchargée ;
- SHA-256 exact ;
- package Android attendu (`com.freekiosk` tant qu'il n'est pas renommé) ;
- certificat de signature attendu ;
- `versionCode` strictement supérieur à la version installée ;
- Wi-Fi disponible et batterie suffisante, sauf si l'appareil charge ;
- espace disque suffisant.

Android vérifie également que la mise à jour porte une signature compatible avec
l'application installée. La clé de signature de production ne doit jamais être
transmise au backend ni intégrée à l'APK.

La chaîne de publication GitHub conserve le déclenchement manuel et limite le
`GITHUB_TOKEN` à `contents: write` pour la création de la Release. Les quatre
secrets `RC_FREEKIOSK_KEYSTORE_BASE64`, `RC_FREEKIOSK_STORE_PASSWORD`,
`RC_FREEKIOSK_KEY_ALIAS` et `RC_FREEKIOSK_KEY_PASSWORD` sont obligatoires : le
workflow échoue si l'un d'eux manque et ne produit jamais de Release signée avec
la clé de debug. Une copie de récupération chiffrée de la clé et de ses mots de
passe doit rester hors de GitHub.

Le workflow dérive aussi `versionName` du tag manuel et génère un `versionCode`
croissant. L'APK est envoyé directement dans GitHub Releases, sans créer
d'artefact GitHub Actions.

Le déploiement recommandé est progressif :

1. tablette de développement ;
2. tablette pilote ;
3. petit groupe de terminaux ;
4. flotte restante après vérification des résultats.

Le serveur doit pouvoir suspendre immédiatement un déploiement. Une rétrogradation
automatique n'est pas prévue en version 1 ; les migrations locales doivent donc
rester compatibles avec la version précédente.

### État actuel du fork

Le module existant `android/app/src/main/java/com/freekiosk/UpdateModule.kt`
consulte désormais les Releases `Belarrius1/rc-freekiosk`, télécharge leur APK et
utilise `PackageInstaller` pour tenter une installation silencieuse en Device
Owner. Avant de le relier à l'API de flotte décrite ici, il reste à :

- ajouter les validations de hash, package, certificat, taille et version à la
  commande distante ;
- relier le résultat réel de `PackageInstaller` au rapport de commande ;
- tester l'installation silencieuse sur la tablette Android 15 définitive.

## 8. Capture d'écran volontaire

`request_screenshot` ne capture rien directement. Son payload contient seulement :

```json
{
  "support_case_id": "RC-2026-0042",
  "reason": "Diagnose distorted navigation menu",
  "expires_at": "2026-08-22T12:20:00Z"
}
```

Flux obligatoire :

1. la tablette affiche « Support requests a screenshot of the current screen.
   Allow once? », la raison et l'identité « Relic Commander Support » ;
2. l'utilisateur choisit `Allow once` ou `Decline` ;
3. après la capture, une prévisualisation propose `Send` ou `Delete` ;
4. seul `Send` demande une session d'upload au backend ;
5. le fichier est envoyé par HTTPS puis supprimé localement ;
6. le backend supprime automatiquement l'image au plus tard après 7 jours ou à
   la clôture du dossier si elle survient avant.

Aucun réglage distant, délai ou mode d'assistance ne peut remplacer ces deux
actions locales. Un refus produit seulement le résultat `user_declined`.

### Création d'une session d'upload

```http
POST /api/terminal/v1/terminals/{terminal_id}/screenshots
Authorization: Bearer <device_token>
Content-Type: application/json
```

```json
{
  "command_id": "01JRC9N41X6N7GPEE5TQJ9DRDF",
  "support_case_id": "RC-2026-0042",
  "content_type": "image/png",
  "size_bytes": 1843200,
  "sha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
}
```

Réponse `201 Created` :

```json
{
  "upload_url": "https://upload.example/single-use-signed-url",
  "required_headers": {
    "Content-Type": "image/png"
  },
  "expires_at": "2026-08-22T12:15:00Z",
  "maximum_size_bytes": 8388608
}
```

L'URL est à usage unique et expire en cinq minutes. Le token du terminal ne doit
pas être envoyé au service de stockage. La capture n'est jamais intégrée au
heartbeat ni conservée dans les logs.

## 9. Permissions Android du fork RC

État actuel du profil RC Terminal :

- les permissions `CAMERA` et `RECORD_AUDIO` ont été retirées du manifeste ;
- la demande automatique de caméra au démarrage a été supprimée ;
- WebView refuse caméra, microphone et géolocalisation aux pages ;
- les réglages motion detection et intercom sont masqués et protégés par des
  garde-fous logiciels, y compris face à une ancienne préférence ou à MQTT ;
- les routes historiques `/api/camera/*`, `/api/screenshot` et `/api/location`
  ont été supprimées ;
- le contrôle de l'API REST historique est désactivé par défaut.

### Microphone

RC-FreeKiosk ne nécessite pas `android.permission.RECORD_AUDIO` pour afficher le
clavier. La dictée vocale est exécutée par l'IME, par exemple Gboard, avec la
permission microphone propre à cet IME.

Le profil RC Terminal retire `RECORD_AUDIO`, refuse la ressource microphone aux
pages WebView et désactive les fonctions WebRTC talk-back de FreeKiosk.
`MODIFY_AUDIO_SETTINGS` est conservée pour le volume et le routage de sortie
audio Bluetooth ; cette permission ne donne pas accès à l'enregistrement.

### Caméra

- les endpoints caméra sont retirés de l'API locale historique ;
- RC-FreeKiosk ne demande plus `CAMERA` au démarrage ;
- WebView n'accorde plus la caméra aux pages ;
- si les tests sont concluants, appliquer aussi le blocage caméra Device Owner
  pour empêcher son utilisation par une autre application.

La lampe torche dépend matériellement de la caméra sur certains appareils. Elle
sera donc indisponible si ce verrouillage global est appliqué, ce qui est acceptable
pour RC Terminal.

### Wi-Fi et localisation

Les permissions Wi-Fi restent nécessaires à la configuration publique :

- `ACCESS_WIFI_STATE` et `CHANGE_WIFI_STATE` ;
- `NEARBY_WIFI_DEVICES` sur Android 13+ ;
- `ACCESS_FINE_LOCATION` lorsque les anciennes versions ou les API de scan
  effectivement utilisées l'exigent.

La présence technique d'une permission de localisation pour le scan Wi-Fi ne
permet jamais au service RC d'appeler un fournisseur GPS ou de transmettre une
position. L'ancien endpoint `/api/location` et son lecteur de dernière position
connue sont supprimés du fork. Toute réduction de `ACCESS_FINE_LOCATION` doit
être testée sur Android 8/9 et Android 15 avant modification du manifeste.

### Bluetooth

Les permissions Bluetooth sont conservées pour le menu public, le scan,
l'association et la connexion à un casque ou un haut-parleur :

- `BLUETOOTH` et `BLUETOOTH_ADMIN` sur Android 11 et versions antérieures ;
- `BLUETOOTH_SCAN` et `BLUETOOTH_CONNECT` sur Android 12+ ;
- `neverForLocation` lorsque compatible avec les opérations réellement utilisées.

Aucune liste d'appareils environnants ou associés n'est transmise au backend.

## 10. Backend et console d'assistance

Pour chaque terminal, le backend conserve au maximum :

- identifiant et libellé administratif ;
- empreinte du token, état actif/révoqué et dernière rotation ;
- compte Relic Commander actuellement lié et historique minimal annoncé ;
- dernier heartbeat et dernier état technique ;
- historique limité des versions ;
- commandes et résultats d'audit ;
- lien temporaire vers une capture consentie.

La console d'assistance doit :

- exiger un compte opérateur protégé par MFA ;
- utiliser des rôles séparant lecture, assistance et déploiement ;
- enregistrer l'opérateur, la commande, la date, la cible et le résultat ;
- demander une confirmation pour un reboot ou un déploiement ;
- ne jamais afficher ni permettre l'export du token d'un terminal ;
- permettre la révocation immédiate d'un terminal perdu ou compromis.

Durées proposées :

| Donnée | Conservation maximale |
|---|---|
| Dernier état technique | Jusqu'au heartbeat suivant |
| Historique de disponibilité agrégé | 30 jours |
| Audit des commandes | 1 an |
| Détails techniques d'échec | 30 jours |
| Historique terminal/compte | Durée définie par la politique annoncée au joueur |
| Capture d'assistance | 7 jours maximum |
| Token révoqué | Empreinte et date uniquement, selon besoin d'audit |

## 11. Résilience et limites

- Timeout réseau client : 15 secondes maximum.
- Backoff exponentiel avec jitter, de 30 secondes à 30 minutes.
- Un échec de supervision ne doit jamais bloquer le jeu ni ouvrir le kiosque.
- La file locale contient au maximum 100 événements nettoyés, sans capture.
- Les événements possèdent un `event_id` pour la déduplication serveur.
- Une heure locale incorrecte ne doit pas empêcher le heartbeat ; le serveur
  renvoie son heure, mais les commandes expirées restent refusées avec une petite
  tolérance documentée.
- Le serveur applique une limite par terminal et une limite globale.
- Un terminal révoqué continue à fonctionner localement comme kiosque, mais ne
  reçoit plus aucune commande.

## 12. Codes HTTP communs

| Code | Signification |
|---|---|
| `200` | Requête traitée |
| `201` | Enrôlement ou upload créé |
| `400` | Corps ou schéma invalide |
| `401` | Authentification invalide |
| `403` | Terminal ou action interdit |
| `404` | Ressource inconnue |
| `409` | Enrôlement utilisé ou commande déjà finalisée |
| `413` | Capture ou payload trop volumineux |
| `422` | Requête valide mais impossible à exécuter |
| `426` | Protocole client trop ancien |
| `429` | Limite de requêtes atteinte |
| `500` | Erreur serveur |
| `503` | Service temporairement indisponible |

Format d'erreur :

```json
{
  "error": {
    "code": "terminal_token_revoked",
    "message": "Terminal authentication has been revoked",
    "request_id": "01JRCA1BTQ7V5P0QF07FXGVZW6"
  }
}
```

`message` ne contient aucun détail interne. `request_id` permet la corrélation
avec les logs serveur.

## 13. Répartition des tâches

### Backend Relic Commander

- schéma de données terminal, token et audit ;
- enrôlement et authentification ;
- endpoint heartbeat et file de commandes ;
- console d'assistance avec rôles et confirmations ;
- session d'upload signée et suppression automatique ;
- orchestration progressive des mises à jour ;
- limites de débit, alertes et métriques.

### RC-FreeKiosk

- stockage sécurisé de l'identité du terminal ;
- collecte minimale et nettoyée du heartbeat ;
- polling sortant HTTPS avec backoff ;
- liste fermée et idempotente des commandes ;
- installation sécurisée et rapport de son résultat réel ;
- interface de consentement et prévisualisation des captures ;
- suppression des endpoints et permissions caméra/microphone ;
- maintien des permissions Wi-Fi et Bluetooth nécessaires.

## 14. Validation avant déploiement

- Intercepter le trafic de test et vérifier qu'aucun secret ou contenu de jeu
  n'apparaît hors du canal TLS.
- Vérifier qu'un token d'une tablette ne fonctionne pas pour une autre.
- Vérifier révocation, rotation, expiration et limites de débit.
- Rejouer deux fois une commande et confirmer une seule exécution.
- Tester une coupure pendant téléchargement et installation d'une mise à jour.
- Présenter un APK signé avec une autre clé et confirmer son rejet.
- Tester une mise à jour RC signée sur Android 9 et Android 15 en Device Owner.
- Refuser une capture et confirmer qu'aucun fichier ni upload n'est créé.
- Accepter puis annuler à la prévisualisation et confirmer la suppression locale.
- Vérifier la suppression serveur automatique après la durée annoncée.
- Confirmer que Wi-Fi, Bluetooth, audio de sortie et clavier fonctionnent sans la
  permission microphone de RC-FreeKiosk.

## 15. Information remise au joueur

La fiche imprimée et la page locale « Privacy & Support » doivent indiquer, en
termes simples :

- quelles données techniques sont envoyées et pourquoi ;
- que le compte Relic Commander utilisé peut être associé au terminal ;
- que la caméra, le microphone et la localisation ne sont pas accessibles au
  support Relic Commander ;
- quelles actions distantes sont possibles ;
- qu'une capture exige toujours une validation et une prévisualisation ;
- combien de temps les données et captures sont conservées ;
- comment contacter le support ou demander la révocation du terminal.

## 16. Références Android

- [Installation d'APK sur un appareil dédié](https://developer.android.com/work/dpc/dedicated-devices/cookbook)
- [API `PackageInstaller`](https://developer.android.com/reference/android/content/pm/PackageInstaller.html)
- [Permissions Bluetooth](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)
- [Permissions des appareils Wi-Fi à proximité](https://developer.android.com/develop/connectivity/wifi/wifi-permissions)
- [Contrôle des permissions par un Device Owner](https://developer.android.com/reference/android/app/admin/DevicePolicyManager.html#setPermissionGrantState(android.content.ComponentName,%20java.lang.String,%20java.lang.String,%20int))
- [Permission microphone de la dictée Gboard](https://support.google.com/gboard/answer/9058584)
