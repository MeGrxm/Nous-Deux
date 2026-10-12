# Nous deux — mise en route

Une appli de listes partagées pour deux, avec une notification sur le téléphone de l'autre à chaque ajout. Elle est gratuite, sans pub ni achat intégré, et fonctionne sur iPhone et Android.

**Comment ça marche**
- **Firebase** (Google, offre gratuite « Spark ») garde les listes et les synchronise en temps réel.
- **ntfy** (appli gratuite et open source) affiche les notifications sur vos téléphones.
- **GitHub Pages** héberge l'appli gratuitement. Vous l'installez ensuite sur l'écran d'accueil, comme une vraie appli.

Comptez environ 30 minutes, une seule fois. Faites les étapes 1 à 5 sur un ordinateur.

---

## 1. Créer le projet Firebase

1. Allez sur https://console.firebase.google.com et connectez-vous avec un compte Google.
2. Cliquez sur **Créer un projet**, nommez-le (par ex. `nous-deux`) et désactivez Google Analytics, inutile ici.
3. Restez sur l'offre gratuite **Spark**. Aucune carte bancaire n'est demandée.

## 2. Récupérer la configuration

1. Sur l'accueil du projet, cliquez sur l'icône **Web `</>`** pour ajouter une appli Web. Nommez-la, mais ne cochez pas « Firebase Hosting ».
2. Firebase affiche un bloc `const firebaseConfig = { ... }`.
3. Ouvrez `config.js` et remplacez chaque `REMPLACER` par les valeurs correspondantes.

Ces valeurs ne sont pas secrètes : la protection vient des règles de l'étape 4.

## 3. Créer vos deux comptes

1. Menu **Authentication**, puis **Commencer**, puis **E-mail/Mot de passe**. Activez la première option et enregistrez.
2. Onglet **Utilisateurs**, puis **Ajouter un utilisateur**. Créez vos deux comptes (e-mail et mot de passe).

## 4. Créer la base et la protéger

1. Menu **Firestore Database**, puis **Créer une base de données**.
2. Choisissez une région en Europe. Elle ne pourra plus être changée ensuite.
3. Choisissez le **mode production**.
4. Onglet **Règles** : effacez le contenu, collez celui de `firestore.rules`, remplacez les deux adresses d'exemple par vos deux e-mails, puis cliquez sur **Publier**.

Seuls vos deux comptes pourront lire ou modifier les listes.

## 5. Mettre l'appli en ligne (GitHub Pages)

1. Créez un compte gratuit sur https://github.com.
2. Créez un dépôt (**New repository**), par ex. `nous-deux`, en **Public**. L'hébergement gratuit l'exige ; rien de sensible n'est dans ces fichiers.
3. Cliquez sur **uploading an existing file** et glissez **tout le contenu** du dossier, y compris le dossier `icons`. Cliquez sur **Commit changes**.
4. Allez dans **Settings**, puis **Pages**. Dans « Branch », choisissez `main`, puis `/ (root)`, et cliquez sur **Save**.
5. Après une à deux minutes, l'adresse s'affiche, du type `https://votre-pseudo.github.io/nous-deux/`.
6. Par précaution, ajoutez ce domaine (`votre-pseudo.github.io`) dans Firebase, menu **Authentication**, puis **Paramètres**, puis **Domaines autorisés**.

## 6. Installer sur chaque téléphone

**iPhone** : ouvrez l'adresse dans **Safari**, touchez le bouton **Partager**, puis **Sur l'écran d'accueil**.
**Android** : ouvrez l'adresse dans **Chrome**, menu **⋮**, puis **Installer l'appli** (ou **Ajouter à l'écran d'accueil**).

Ouvrez l'appli, connectez-vous et indiquez votre prénom. Les réglages s'ouvrent ensuite automatiquement.

## 7. Activer les notifications (chacun sur son téléphone)

1. Installez **ntfy** depuis l'App Store ou le Play Store. C'est gratuit.
2. Dans Nous deux, ouvrez les **Réglages** (roue dentée) et copiez votre **sujet** (`nousdeux-…`).
3. Dans ntfy, touchez **+**, gardez le serveur `ntfy.sh` et collez le sujet.
4. Revenez dans Nous deux et touchez **Envoyer une notification de test**.

Chacun a son propre sujet : vous êtes prévenu des ajouts de l'autre, jamais des vôtres.

**Confidentialité.** Le sujet ntfy fonctionne comme un mot de passe : ne le partagez pas. Le texte des notifications transite par les serveurs de ntfy. Si vous préférez, désactivez « Voir le contenu des tâches dans mes notifications » : vous recevrez alors simplement « Ben a ajouté une tâche ».

---

## Le calendrier commun (sans code)

Le plus fiable est d'utiliser un **agenda Google partagé**. Il s'affiche directement dans l'appli Calendrier de l'iPhone et dans Google Agenda sur Android. Il se synchronise dans les deux sens et chacun peut ajouter ou modifier des événements depuis son appli habituelle.

**A. Créer l'agenda** (sur ordinateur, https://calendar.google.com)
1. À gauche, à côté de **Autres agendas**, cliquez sur **+**, puis **Créer un agenda**, et nommez-le « Nous deux ».
2. Ouvrez ses paramètres, rubrique **Partager avec des personnes spécifiques**. Ajoutez l'adresse Google de l'autre avec le droit **Apporter des modifications aux événements**.

La personne sur iPhone a donc besoin d'un compte Google, gratuit. Ce peut être le même e-mail que pour l'appli.

**B. Sur Android** : l'agenda apparaît dans Google Agenda. Si ce n'est pas le cas, menu **☰**, puis faites défiler et cochez « Nous deux ».

**C. Sur iPhone** : **Réglages**, puis **Calendrier** (selon la version d'iOS : **Réglages**, puis **Apps**, puis **Calendrier**), puis **Comptes**, **Ajouter un compte**, **Google**. Connectez-vous et laissez **Calendriers** activé. « Nous deux » apparaît dans l'appli Calendrier, à côté du calendrier iCloud personnel.
- S'il n'apparaît pas, plusieurs guides indiquent qu'il faut le cocher sur la page https://calendar.google.com/calendar/syncselect, connecté au compte Google de l'iPhone. *À vérifier, cette page est ancienne.*
- Astuce : dans l'appli Calendrier, choisissez « Nous deux » comme **calendrier par défaut** si vous l'utilisez surtout pour les sorties communes.

**D. (Facultatif) Voir l'agenda perso de l'autre en lecture seule**
- Depuis l'iPhone : dans l'appli Calendrier, touchez **(i)** à côté du calendrier iCloud, activez **Calendrier public** et partagez le lien. Sur un ordinateur, la personne sur Android l'ajoute dans Google Agenda : **Autres agendas**, **+**, **À partir de l'URL**.
- Google ne rafraîchit ces abonnements que de temps en temps, avec un délai qui peut être de plusieurs heures. *À vérifier.*

**Notifications côté calendrier.** Un agenda partagé ne prévient pas quand l'autre ajoute un événement. Pour un événement qui vous concerne tous les deux, ajoutez l'autre comme **invité** : il recevra alors une invitation sur son téléphone. *Je ne peux pas garantir que l'invitation déclenche une notification sur iPhone dans tous les cas : testez-le une fois.*

---

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js` | L'appli |
| `config.js` | Votre configuration Firebase (étape 2) |
| `firestore.rules` | Règles d'accès à coller dans Firebase (étape 4) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installation sur l'écran d'accueil et fonctionnement hors ligne |

## Bon à savoir

- **Hors ligne** : vous pouvez cocher et ajouter des tâches sans réseau. La synchronisation se fait au retour de la connexion. Les notifications d'ajouts faits hors ligne ne partent pas.
- **Gratuité** : l'offre Spark de Firebase est très au-dessus de l'usage d'un couple. Les quotas exacts peuvent évoluer : vérifiez-les sur https://firebase.google.com/pricing.
- **Mises à jour** : pour modifier l'appli, remplacez les fichiers sur GitHub. Les téléphones récupèrent la nouvelle version à l'ouverture suivante.
