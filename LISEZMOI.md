# Nous deux — mise en route

Une appli de listes et d'agenda partagés pour deux. L'autre reçoit une notification à chaque ajout, et chacun peut programmer des rappels à l'heure voulue. Elle est gratuite, sans pub ni achat intégré, et fonctionne sur iPhone et Android.

**Comment ça marche**
- **Firebase** (Google, offre gratuite « Spark ») garde les listes et l'agenda, et les synchronise en temps réel.
- **ntfy** (appli gratuite et open source) affiche les notifications et les rappels sur vos téléphones.
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
2. Onglet **Utilisateurs**, puis **Ajouter un utilisateur**. Créez vos deux comptes avec des mots de passe longs et uniques, qui ne servent nulle part ailleurs.
3. Fermez la porte aux inscriptions : onglet **Paramètres**, rubrique **Actions des utilisateurs** (le libellé exact peut varier), décochez la **création de compte (inscription)** et enregistrez. Ainsi, personne d'autre ne peut se créer un compte sur votre projet.

## 4. Créer la base et la protéger

1. Menu **Firestore Database**, puis **Créer une base de données**.
2. Choisissez une région en Europe. Elle ne pourra plus être changée ensuite.
3. Choisissez le **mode production**.
4. Onglet **Règles** : effacez le contenu, collez celui de `firestore.rules`, remplacez les deux adresses d'exemple par vos deux e-mails, **en minuscules**, puis cliquez sur **Publier**.

Seuls vos deux comptes pourront lire ou modifier les listes.

## 5. Mettre l'appli en ligne (GitHub Pages)

1. Créez un compte gratuit sur https://github.com.
2. Créez un dépôt (**New repository**), par ex. `nous-deux`. Gardez-le **privé** si votre compte permet GitHub Pages en privé, sinon passez-le en public : rien de secret n'est dans ces fichiers.
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

Chacun a son propre sujet : vous êtes prévenu des ajouts de l'autre, jamais des vôtres. Les rappels, eux, arrivent chez la ou les personnes concernées (« Pour moi », « Pour l'autre » ou « Nous deux »).

**Confidentialité.** Les notifications ne contiennent jamais le contenu de vos tâches ou événements : seulement « Ben a ajouté une tâche » ou « Un événement commence à 14:00 ». Le sujet ntfy fonctionne comme un mot de passe : ne le partagez pas.

**Comment marchent les rappels.** ntfy.sh peut programmer une notification jusqu'à 3 jours à l'avance. L'appli programme donc, à chaque ouverture par l'un de vous deux, les rappels des 3 prochains jours. Elle les remplace si vous changez l'heure et les annule si vous supprimez ou cochez l'élément. **Conséquence :** si aucun de vous deux n'ouvre l'appli pendant plus de 3 jours, un rappel plus lointain ne sera pas programmé à temps. Dans la pratique, ouvrir l'appli une fois tous les 2 ou 3 jours suffit.

---

## L'agenda

L'agenda est intégré à l'appli (onglet **Agenda**). Chacun choisit sa couleur dans les **Réglages**. Les événements « Nous deux » portent vos deux couleurs.

- **Ajouter un événement** : titre, pour qui, date, horaires (une fin plus tôt que le début, par exemple 22:00 → 06:00, signifie que l'événement finit le lendemain), rappel, répétition et note.
- **Mois, Semaine ou Jour** : choisissez l'affichage en haut de l'agenda. En Semaine et en Jour, les événements sont placés sur une grille horaire (la ligne rouge marque l'heure actuelle) ; touchez un créneau vide pour créer un événement à cette heure. Balayez vers la gauche ou la droite pour passer à la période suivante ou précédente.
- **Sur plusieurs jours** (vacances, week-end…) : remplissez « Du » et « Au ». L'événement apparaît chaque jour, avec un seul rappel au début. Un événement sur plusieurs jours ne se répète pas.
- **Répétitions** : chaque jour, du lundi au vendredi, chaque semaine, toutes les 2 semaines ou chaque mois, avec une date de fin facultative. Pour une série, vous pouvez supprimer un seul jour ou toute la série.
- **Filtre** « Tous / Moi / l'autre » pour voir l'emploi du temps d'une seule personne.
- Les **tâches avec une date** apparaissent aussi sous le jour concerné.

**Voir l'agenda dans le Calendrier du téléphone** : c'est possible en lecture seule, grâce à un petit service gratuit chez Cloudflare. Voir la partie suivante. Le sens inverse (du téléphone vers l'appli) n'est pas prévu.

---

## Calendrier du téléphone (facultatif)

Une fois en place, tout ce que vous ajoutez dans l'agenda de l'appli apparaît tout seul :
- **sur Android**, directement dans **Google Agenda** : un agenda « Nous deux » est mis à jour quelques instants après chaque modification ;
- **sur iPhone**, dans l'appli **Calendrier**, grâce à un abonnement.

On modifie toujours dans Nous deux : côté téléphone, c'est en lecture seule. Les rappels continuent de venir de Nous deux, donc vous ne recevrez pas d'alerte en double.

Comptez environ 20 minutes pour les étapes A à E, communes aux deux téléphones, et 15 minutes de plus pour la partie Google (F à H).

**A. Créer un compte « robot »** (Firebase, menu **Authentication**, onglet **Utilisateurs**)
1. **Ajouter un utilisateur** : comme e-mail, une variante de la vôtre, par exemple `votre.adresse+robot@gmail.com`, avec un mot de passe long et unique.
2. Dans la liste, copiez son **UID utilisateur** (la longue suite de caractères).

**B. Lui donner accès à l'agenda seulement** (menu **Firestore**, onglet **Règles**)
- Dans les règles, remplacez `REMPLACER_PAR_UID_DU_ROBOT` par cet UID, puis **Publier**.
- Le robot peut seulement lire l'agenda, les prénoms et les réglages du calendrier, et tenir à jour la synchronisation Google. Il ne voit pas vos listes et ne peut rien modifier d'autre.

**C. Créer le service chez Cloudflare** (gratuit ; l'interface peut varier légèrement)
1. Créez un compte sur https://dash.cloudflare.com/sign-up.
2. Menu **Workers & Pages**, puis **Create**, puis **Create Worker**. Nommez-le `nous-deux` et cliquez sur **Deploy**.
3. Cliquez sur **Edit code**, effacez tout et collez le contenu du fichier `cloudflare/worker.js`, puis **Deploy**.
4. Onglet **Settings**, rubrique **Variables and Secrets**, ajoutez :

| Nom | Type | Valeur |
|---|---|---|
| `FIREBASE_API_KEY` | Text | la valeur `apiKey` de `config.js` |
| `FIREBASE_PROJECT_ID` | Text | `nous-deux-acc45` |
| `ROBOT_EMAIL` | Text | l'e-mail du robot |
| `ROBOT_PASSWORD` | **Secret** | le mot de passe du robot |

5. Enregistrez et redéployez si Cloudflare le demande. Notez l'adresse du service, du type `https://nous-deux.votre-pseudo.workers.dev`. Gardez bien cette adresse en `.workers.dev` : l'appli n'est autorisée à contacter que ce type d'adresse.

**D. Créer les liens dans l'appli**
Dans **Réglages**, partie **Calendrier du téléphone**, collez l'adresse du service et touchez **Créer les liens d'abonnement**.

**E. iPhone : s'abonner**
Dans les Réglages de Nous deux, sur l'iPhone, touchez **S'abonner** (tout l'agenda, ou moi + nous deux), puis confirmez. Le calendrier apparaît dans l'appli Calendrier.

### Google Agenda (pour le téléphone Android)

Le bouton « Connecter Google Agenda » de l'appli a besoin que Google connaisse l'appli. Il faut donc l'enregistrer une fois dans la console Google Cloud. C'est gratuit et sans carte bancaire, à ma connaissance ; vérifiez-le à la création du projet. L'interface de Google change souvent : les noms ci-dessous peuvent varier un peu.

**F. Enregistrer l'appli chez Google** (sur ordinateur, avec le compte Google qui recevra l'agenda ou un autre)
1. Allez sur https://console.cloud.google.com, ouvrez le sélecteur de projet en haut, puis **Nouveau projet**. Nommez-le « Nous deux » et cliquez sur **Créer**.
2. Menu **API et services**, puis **Bibliothèque**. Cherchez **Google Calendar API** et cliquez sur **Activer**.
3. Menu **Google Auth Platform** (ou **Écran de consentement OAuth**), puis **Commencer** :
   - nom de l'application : `Nous deux` ; e-mail d'assistance : le vôtre ;
   - audience : **Externe** ;
   - coordonnées : votre e-mail. Acceptez les conditions, puis **Créer**.
4. Rubrique **Audience**, puis **Publier l'application** pour passer « En production ». **Important** : en mode « Test », Google coupe l'autorisation au bout de 7 jours.
5. Rubrique **Accès aux données**, puis **Ajouter ou supprimer des champs d'application**. Cochez ou collez `https://www.googleapis.com/auth/calendar.app.created` et enregistrez.
6. Rubrique **Clients**, puis **Créer un client** :
   - type : **Application Web** ; nom : `Nous deux` ;
   - **URI de redirection autorisés** : `https://nous-deux.votre-pseudo.workers.dev/google/callback`, avec votre adresse de service suivie de `/google/callback` ;
   - **Créer**, puis copiez l'**ID client** et le **code secret**.

**G. Les donner au service** (Cloudflare, votre Worker `nous-deux`)
1. Onglet **Settings**, rubrique **Variables and Secrets**, ajoutez :

| Nom | Type | Valeur |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Text | l'ID client |
| `GOOGLE_CLIENT_SECRET` | **Secret** | le code secret |

2. Toujours dans **Settings**, rubrique **Trigger events** (ou **Triggers**), ajoutez un **Cron Trigger** : `*/15 * * * *`. C'est le passage de rattrapage toutes les 15 minutes ; les modifications partent de toute façon tout de suite.
3. Redéployez si Cloudflare le demande.

**H. Connecter, une seule fois**
1. Dans Nous deux, ouvrez **Réglages**, puis **Google Agenda**, et choisissez les **événements envoyés** : tout l'agenda, ou « prénom + nous deux ».
2. Touchez **Connecter Google Agenda** et choisissez le compte Google qui doit recevoir l'agenda.
3. Google peut afficher **« Google n'a pas validé cette application »**. C'est normal pour une appli personnelle que vous avez créée vous-même : touchez **Paramètres avancés**, puis **Accéder à Nous deux (non sécurisé)**.
4. Autorisez l'accès demandé, qui permet de créer ses propres agendas et de gérer leurs événements. Une page « Google Agenda est connecté ✅ » s'affiche.
5. Un agenda **« Nous deux »** apparaît dans Google Agenda, sur le téléphone comme sur ordinateur, dans les couleurs choisies dans l'appli. S'il n'est pas visible, cochez-le dans la liste des agendas.

C'est tout : plus rien à faire ensuite. Dans les Réglages de l'appli, vous voyez à tout moment « Synchronisé il y a X min ».

**Ce que le service peut faire dans votre compte Google** : uniquement créer ses propres agendas et gérer leurs événements. Il **ne peut pas** lire votre agenda personnel, vos e-mails ni vos contacts. L'autorisation est stockée chiffrée et lisible par le robot seulement. Vous pouvez la retirer à tout moment, depuis l'appli (**Déconnecter**) ou depuis votre compte Google (**Sécurité**, puis **Applications tierces**).

**Si quelque chose se passe** :
- Vous supprimez l'agenda « Nous deux » dans Google : le service le remarque et se déconnecte proprement. Reconnectez pour le recréer.
- Google retire l'autorisation (par exemple après un changement de mot de passe Google) : l'appli affiche « reconnectez Google Agenda ». Un geste suffit.

**Sécurité des liens iPhone** : les liens d'abonnement sont secrets, car quiconque les connaît peut lire l'agenda. En cas de doute, **Changer les liens** les remplace tout de suite ; il faut alors se réabonner sur l'iPhone. Les mots de passe et secrets sont stockés chiffrés chez Cloudflare. Le contenu de l'agenda transite par Cloudflare et par Google.

---

## Les autres outils

- **Courses par rayon** : dans une liste de type « Courses », chaque article est rangé automatiquement dans son rayon (fruits et légumes, frais, boissons…), dans l'ordre d'un magasin. Le rayon deviné s'affiche pendant la saisie ; vous pouvez le changer.
- **Résumé du matin** : une notification à l'heure choisie (8 h par défaut) avec le nombre de tâches et d'événements du jour. Il ne part pas les jours où rien n'est prévu. Réglable ou désactivable dans les Réglages.

Le type d'une liste (classique ou courses) se choisit en la créant ou en la modifiant (bouton **⋯**).

---

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css`, `app.js`, `rayons.js` | L'appli (`rayons.js` contient le classement des articles par rayon) |
| `config.js` | Votre configuration Firebase (étape 2) |
| `firestore.rules` | Règles d'accès à coller dans Firebase (étape 4). À recoller à chaque nouvelle version. |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installation sur l'écran d'accueil et fonctionnement hors ligne |
| `cloudflare/worker.js` | Le service calendrier (abonnement iPhone et Google Agenda), à coller chez Cloudflare. Inutile de l'envoyer sur GitHub. |

## Bon à savoir

- **Hors ligne** : vous pouvez cocher et ajouter des tâches sans réseau. La synchronisation se fait au retour de la connexion. Les notifications d'ajouts faits hors ligne ne partent pas ; les rappels sont programmés dès le retour du réseau.
- **Tâches récurrentes** : quand on coche une tâche qui se répète, elle revient automatiquement à sa prochaine date.
- **Gratuité** : l'offre Spark de Firebase est très au-dessus de l'usage d'un couple. Les quotas exacts peuvent évoluer : vérifiez-les sur https://firebase.google.com/pricing.
- **Mises à jour** : pour modifier l'appli, remplacez les fichiers sur GitHub. Les téléphones récupèrent la nouvelle version à l'ouverture suivante.
