/**
 * Greek — the DEFAULT locale, and the file that DEFINES the resource shape.
 *
 * `Translation` is `typeof el`, so `en.ts` is checked against this object: a key added here
 * and forgotten there is a compile error, not a screen that silently renders `settings.theme`
 * to an English-speaking trainer. Greek is the source rather than English because Greek is
 * what ships — the fallback is allowed to lag, the default is not.
 *
 * Ported from `L` in the design prototype's `trainhub-data.js`, with these deliberate changes:
 *
 *  - **Counted nouns are real plural keys** (`_one` / `_other`), not a base string with an "s"
 *    glued on. The prototype rendered `t.exercise + "s"`, which is "Άσκησηs" in Greek, and used
 *    the bare plural `t.sessions` after a number, which is "1 προπονήσεις". i18next picks the
 *    form from `Intl.PluralRules`, so Greek gets `προπόνηση` at 1 and English gets `session`.
 *    See the `counts` group.
 *  - **Roles are `owner` and `trainer` only.** The prototype had four; the schema has two
 *    (`MemberRole`). Shipping labels for roles the database cannot store invites a screen to
 *    render a role nobody can ever hold.
 *  - **`csv` is an object, not a positional array.** As an array, inserting a column meant
 *    renumbering eleven strings in two languages and the mistake was invisible until export.
 *  - **Dropped:** `local`, `warning`, `demoLogin`, `continueWithGoogle`, `googleDemoNote`,
 *    `resetDemo`, `resetConfirm`. Those describe a localStorage prototype with Google sign-in
 *    and a demo-reset button. This app is Supabase-backed with email OTP and has none of them;
 *    `auth.notConfigured*` replaces `warning` with the state that can actually occur.
 *
 * Keys under `categories`, `equipmentTypes`, `apptTypes`, `roles`, `statuses` and `setKinds`
 * are exactly the domain unions in `@/domain/types`, so `t(\`categories.${category}\`)` is
 * total for every value the database can hold.
 */
export const el = {
  brand: {
    name: 'TrainHub',
    tagline: 'Όπου καταγράφεται κάθε επανάληψη.',
  },

  common: {
    add: 'Προσθήκη',
    back: 'Πίσω',
    cancel: 'Άκυρο',
    close: 'Κλείσιμο',
    date: 'Ημερομηνία',
    delete: 'Διαγραφή',
    done: 'Έτοιμο',
    edit: 'Επεξεργασία',
    email: 'Email',
    filterAll: 'Όλα',
    loading: 'Φόρτωση…',
    name: 'Όνομα',
    none: 'Κανένα',
    notes: 'Σημειώσεις',
    or: 'ή',
    retry: 'Δοκίμασε ξανά',
    role: 'Ρόλος',
    save: 'Αποθήκευση',
    saved: 'Αυτόματη αποθήκευση',
    search: 'Αναζήτηση',
    time: 'Ώρα',
    unassigned: 'Χωρίς ανάθεση',
    undo: 'Αναίρεση',
    archive: 'Αρχειοθέτηση',
    confirm: 'Επιβεβαίωση',
    copy: 'Αντιγραφή',
    copied: 'Αντιγράφηκε',
    optional: 'Προαιρετικό',
    /** A write that left the device but has not reached a server. Not an error, and never
        rendered as one — the coach's set is safe, it is just not shared yet. */
    queued: 'Στην ουρά — θα σταλεί μόλις υπάρξει σύνδεση.',
    remove: 'Αφαίρεση',
    you: 'Εσύ',
  },

  nav: {
    athletes: 'Αθλητές',
    calendar: 'Ημερολόγιο',
    library: 'Ασκήσεις',
    team: 'Ομάδα',
    settings: 'Ρυθμίσεις',
    /** aria-label on the tab bar itself — a screen reader needs the landmark named. */
    primary: 'Κύρια πλοήγηση',
  },

  /**
   * Counted nouns. Every one of these takes `{{count}}` and exists in both plural categories
   * Greek and English use (`one` and `other`). `σετ` and `ραντεβού` are genuinely invariant in
   * Greek — the two identical strings are the correct answer, not a copy-paste slip.
   */
  counts: {
    athlete_one: '{{count}} αθλητής',
    athlete_other: '{{count}} αθλητές',
    session_one: '{{count}} προπόνηση',
    session_other: '{{count}} προπονήσεις',
    exercise_one: '{{count}} άσκηση',
    exercise_other: '{{count}} ασκήσεις',
    set_one: '{{count}} σετ',
    set_other: '{{count}} σετ',
    rep_one: '{{count}} επανάληψη',
    rep_other: '{{count}} επαναλήψεις',
    member_one: '{{count}} μέλος',
    member_other: '{{count}} μέλη',
    coach_one: '{{count}} προπονητής',
    coach_other: '{{count}} προπονητές',
    appointment_one: '{{count}} ραντεβού',
    appointment_other: '{{count}} ραντεβού',
    minute_one: '{{count}} λεπτό',
    minute_other: '{{count}} λεπτά',
  },

  auth: {
    title: 'Καλώς ήρθες',
    subtitle: 'Κατέγραψε τις προπονήσεις σου, παντού.',
    signIn: 'Σύνδεση',
    createAccount: 'Νέος λογαριασμός',
    emailLabel: 'Email',
    emailPlaceholder: 'onoma@parádeigma.gr',
    yourName: 'Όνομα',
    sendCode: 'Στείλε μου κωδικό',
    codeLabel: 'Κωδικός μιας χρήσης',
    codeSent: 'Στείλαμε 6ψήφιο κωδικό στο {{email}}.',
    verify: 'Επιβεβαίωση',
    resendCode: 'Νέα αποστολή κωδικού',
    changeEmail: 'Αλλαγή email',
    signOut: 'Αποσύνδεση',
    signedInAs: 'Σύνδεση ως',
    account: 'Λογαριασμός',
    checkingSession: 'Έλεγχος σύνδεσης…',
    haveInvite: 'Έχεις σύνδεσμο πρόσκλησης;',
    notConfiguredTitle: 'Ο διακομιστής δεν έχει ρυθμιστεί',
    notConfiguredBody: 'Λείπουν οι μεταβλητές περιβάλλοντος: {{vars}}.',
    /** Why there is no Google button. A coach who has used one asks, and the answer is the
        reason this product exists: an OAuth redirect leaves the installed app signed out. */
    otpOnly: 'Χωρίς κωδικό πρόσβασης. Σου στέλνουμε 6ψήφιο κωδικό στο email κάθε φορά.',
    demoTitle: 'Λειτουργία επίδειξης',
    demoBody:
      'Δεν έχει ρυθμιστεί διακομιστής, οπότε η εφαρμογή τρέχει με δεδομένα-δείγμα αποθηκευμένα μόνο σε αυτή τη συσκευή. Μπορείς να τη δοκιμάσεις κανονικά.',
    demoEnter: 'Είσοδος στην εφαρμογή',
    emailRequired: 'Γράψε το email σου.',
    emailInvalid: 'Αυτό δεν μοιάζει με διεύθυνση email.',
    codeRequired: 'Γράψε τον 6ψήφιο κωδικό.',
    codeHint: 'Ο κωδικός ισχύει για λίγα λεπτά. Κοίτα και τα ανεπιθύμητα.',
    codeInvalid: 'Ο κωδικός δεν είναι σωστός. Έλεγξε τα ψηφία ή ζήτα νέον.',
    codeExpired: 'Ο κωδικός έληξε. Ζήτα νέον κωδικό.',
    codeResent: 'Στάλθηκε νέος κωδικός.',
    rateLimited: 'Πολλές προσπάθειες. Περίμενε ένα λεπτό και ξαναδοκίμασε.',
    offline: 'Δεν υπάρχει σύνδεση με τον διακομιστή. Έλεγξε το δίκτυο και δοκίμασε ξανά.',
    sendFailed: 'Ο κωδικός δεν στάλθηκε.',
    verifyFailed: 'Η επιβεβαίωση απέτυχε.',
  },

  join: {
    title: 'Είσοδος σε γυμναστήριο',
    subtitle: 'Ο σύνδεσμος πρόσκλησης σε βάζει στην ομάδα ενός γυμναστηρίου.',
    codeLabel: 'Κωδικός πρόσκλησης',
    submit: 'Είσοδος',
    invalid: 'Μη έγκυρος ή ληγμένος κωδικός.',
    linkReceived: 'Ο κωδικός πρόσκλησης παραλήφθηκε από τον σύνδεσμο.',
    linkStripped: 'Αφαιρέθηκε αμέσως από τη γραμμή διευθύνσεων.',
    noSecret: 'Ο σύνδεσμος δεν περιέχει κωδικό πρόσκλησης.',
    signInFirst: 'Συνδέσου πρώτα με το email σου και μετά ξαναπάτα τον σύνδεσμο.',
    held: 'Ο κωδικός φυλάσσεται σε αυτή την καρτέλα μέχρι να συνδεθείς.',
    codeHint: 'Αν ο σύνδεσμος άνοιξε σε άλλο πρόγραμμα περιήγησης, επικόλλησε εδώ τον κωδικό από το τέλος του — ό,τι ακολουθεί το #.',
    codeRequired: 'Επικόλλησε τον κωδικό πρόσκλησης.',
    joined: 'Μπήκες στην ομάδα',
    joinedBody: 'Ο λογαριασμός σου είναι πλέον μέλος του γυμναστηρίου. Κάθε τι που καταγράφεις θα φέρει το όνομά σου.',
    already: 'Είσαι ήδη μέλος αυτού του γυμναστηρίου.',
    /** `redeem_invite` δίνει έναν και μόνο λόγο αποτυχίας, επίτηδες. Λέμε τι μπορεί να φταίει
        και ποια είναι η κίνηση που λύνει και τις τέσσερις περιπτώσεις. */
    invalidHint:
      'Ο σύνδεσμος μπορεί να έχει λήξει, να ανακλήθηκε, να χρησιμοποιήθηκε ήδη ή να αφορά άλλο email. Ζήτα νέα πρόσκληση από τον ιδιοκτήτη του γυμναστηρίου.',
  },

  athletes: {
    title: 'Αθλητές',
    searchPlaceholder: 'Αναζήτηση αθλητών',
    add: 'Νέος αθλητής',
    empty: 'Κανένας αθλητής ακόμα',
    emptyHint: 'Πάτα + για να προσθέσεις τον πρώτο.',
    lastSession: 'Τελευταία',
    noPrevious: 'Καμία προηγούμενη προπόνηση',
    open: 'Άνοιγμα',
    noMatches: 'Καμία αντιστοιχία',
    /** Says out loud that accents are optional — half the roster is typed without them. */
    noMatchesHint: 'Δοκίμασε μέρος του επωνύμου. Η αναζήτηση αγνοεί τόνους.',
    clearSearch: 'Καθαρισμός αναζήτησης',
  },

  athlete: {
    goal: 'Στόχος',
    memberSince: 'Μέλος από',
    assignedCoach: 'Ανατεθειμένος προπονητής',
    coach: 'Προπονητής',
    assignCoach: 'Ανάθεση προπονητή',
    assignHint: 'Ο ιδιοκτήτης αναθέτει προπονητή σε κάθε μέλος.',
    briefing: 'Ενημέρωση',
    planPhase: 'Φάση',
    planFocus: 'Εστίαση',
    pinnedNotes: 'Καρφιτσωμένες σημειώσεις',
    history: 'Ιστορικό',
    thisWeek: 'Αυτή την εβδομάδα',
    newSession: 'Νέα προπόνηση',
    noSessionsYet: 'Καμία προπόνηση ακόμα',
    startFirst: 'Ξεκίνα την πρώτη προπόνηση',
    edit: 'Επεξεργασία αθλητή',
    deleteConfirm: 'Διαγραφή αθλητή και προπονήσεων;',
    statSessions: 'Προπονήσεις',
    lastSessionTitle: 'Τελευταία προπόνηση',
    notFound: 'Ο αθλητής δεν βρέθηκε',
    notFoundHint: 'Ίσως διαγράφηκε ή ο σύνδεσμος είναι λάθος.',
    openLog: 'Άνοιγμα προπόνησης',
    archive: 'Διαγραφή αθλητή',
    deleteExplain: 'Ο αθλητής φεύγει από τη λίστα. Το ιστορικό του μένει καταγεγραμμένο.',
    noCoach: 'Χωρίς προπονητή',
    phone: 'Τηλέφωνο',
  },

  log: {
    title: 'Καταγραφή',
    workoutTitle: 'Τίτλος προπόνησης',
    sessionNotes: 'Σημειώσεις προπόνησης',
    /** Two author fields, never one: who typed it, and whose session it was. */
    loggedBy: 'Καταγραφή από',
    creditedTo: 'Χρεώνεται σε',
    category: 'Κατηγορία',
    exercise: 'Άσκηση',
    set: 'Σετ',
    kg: 'Κιλά',
    reps: 'Επαν.',
    seconds: 'Δευτ.',
    meters: 'Μέτρα',
    rpe: 'RPE',
    addSet: 'Προσθήκη σετ',
    repeatLast: 'Επανάληψη',
    addExercise: 'Προσθήκη άσκησης',
    removeExercise: 'Αφαίρεση',
    totalVolume: 'Όγκος',
    totalSets: 'Σετ',
    workingSets: 'σετ εργασίας',
    rest: 'Ξεκούραση',
    restTimer: 'Χρονόμετρο',
    finish: 'Ολοκλήρωση',
    live: 'Σε εξέλιξη',
    lastTime: 'Τελευταία φορά',
    topSet: 'Κορυφαίο σετ',
    personalRecord: 'PR',
    currentSession: 'Τρέχουσα προπόνηση',
    deleteConfirm: 'Διαγραφή προπόνησης;',
    /** "Ίδιο με πριν" is the one-tap path: it clones the previous set without opening the pad. */
    sameAsPrevious: 'Ίδιο με πριν',
    minutes: 'Λεπτά',
    noExercises: 'Καμία άσκηση ακόμα',
    noExercisesHint: 'Πρόσθεσε την πρώτη άσκηση της προπόνησης.',
    noSets: 'Κανένα σετ ακόμα',
    firstTime: 'Πρώτη φορά σε αυτή την άσκηση',
    setNumber: 'Σετ {{number}}',
    editValue: '{{field}} — {{exercise}}',
    thisSession: 'Σε αυτή την προπόνηση',
    setDeleted: 'Το σετ διαγράφηκε',
    exerciseRemoved: 'Η άσκηση αφαιρέθηκε',
    removeBlocked: 'Διάγραψε πρώτα τα σετ',
    sessionMissing: 'Η προπόνηση δεν βρέθηκε',
    sessionMissingHint: 'Ίσως διαγράφηκε από άλλον προπονητή.',
    finished: 'Ολοκληρώθηκε',
    finishTitle: 'Ολοκλήρωση προπόνησης',
    /** Finishing is not a lock. Say so, or a coach retypes the last set on paper. */
    finishHint: 'Μπορείς να προσθέσεις σετ και μετά την ολοκλήρωση.',
    sessionFinished: 'Η προπόνηση ολοκληρώθηκε',
    howDidItGo: 'Πώς πήγε;',
    optional: 'Προαιρετικό',
    noteForNext: 'Σημείωση για τον επόμενο',
    notePlaceholder: 'Τι πρέπει να ξέρει ο επόμενος προπονητής;',
    pinNote: 'Καρφίτσωμα στην κορυφή',
    quickIncrease: 'Αύξησε',
    quickHold: 'Κράτα',
    quickPain: 'Ανέφερε πόνο',
    quickIncreaseText: 'Αύξησε 2,5 kg την επόμενη φορά.',
    quickHoldText: 'Κράτα το ίδιο βάρος, δούλεψε την τεχνική.',
    quickPainText: 'Ανέφερε πόνο — έλεγξε πριν φορτώσεις.',
    restIdle: 'Χωρίς χρονόμετρο',
    restStart: 'Ξεκούραση {{seconds}} δευτ.',
    restExtend: '+15 δευτ.',
    restStop: 'Σταμάτα',
    restRemaining: 'Υπόλοιπο ξεκούρασης',
  },

  picker: {
    title: 'Επιλογή άσκησης',
    searchOrType: 'Αναζήτηση ή πληκτρολόγησε άσκηση…',
    noMatches: 'Καμία αντιστοιχία',
    addCustomHint: 'Πρόσθεσέ τη ως δική σου άσκηση',
    create: 'Δημιουργία',
    recent: 'Πρόσφατες',
    allExercises: 'Όλες οι ασκήσεις',
    createTitle: 'Νέα άσκηση',
    /** The Greek name is the required one; English is the courtesy. */
    createHint: 'Το ελληνικό όνομα είναι υποχρεωτικό.',
  },

  library: {
    title: 'Βιβλιοθήκη ασκήσεων',
    add: 'Νέα άσκηση',
    category: 'Κατηγορία',
    equipment: 'Εξοπλισμός',
    allEquipment: 'Όλα',
    /** The prototype's `createExercise` never set a Greek name, so every custom exercise
        was English-only in a Greek UI. Here the Greek name is the required one. */
    nameEl: 'Ελληνικό όνομα',
    nameEn: 'Αγγλικό όνομα (προαιρετικό)',
    setKind: 'Τύπος σετ',
    defaultRest: 'Προεπιλεγμένη ξεκούραση',
    archived: 'Αρχειοθετημένη',
    deleteConfirm: 'Διαγραφή άσκησης;',
    subtitle: 'Ο κοινός κατάλογος και οι δικές σας ασκήσεις, μαζί.',
    searchPlaceholder: 'Αναζήτηση άσκησης',
    noMatches: 'Καμία άσκηση δεν ταιριάζει',
    noMatchesHint: 'Η αναζήτηση αγνοεί τόνους. Δοκίμασε λιγότερα γράμματα ή άλλαξε φίλτρο.',
    empty: 'Ο κατάλογος είναι άδειος',
    emptyHint: 'Πάτα «Νέα άσκηση» για να προσθέσεις την πρώτη.',
    /** Which rows this gym may change and which belong to everyone. A trainer who does not
        know the difference tries to archive a shared row and reads the refusal as a bug. */
    shared: 'Κοινός κατάλογος',
    own: 'Δική μας',
    source: 'Προέλευση',
    showArchived: 'Και οι αρχειοθετημένες',
    archiveAction: 'Αρχειοθέτηση άσκησης',
    archiveHint:
      'Φεύγει από τη λίστα και από τον επιλογέα. Οι παλιές προπονήσεις που τη χρησιμοποιούν μένουν ανέπαφες — γι᾽ αυτό αρχειοθετούμε αντί να διαγράφουμε.',
    archiveOneWay: 'Η αρχειοθέτηση δεν αναιρείται μέσα από την εφαρμογή.',
    archiveConfirm: 'Αρχειοθέτηση;',
    archiveDone: 'Η άσκηση αρχειοθετήθηκε.',
    archiveFailed: 'Η αρχειοθέτηση δεν αποθηκεύτηκε. Δοκίμασε ξανά.',
    sharedLocked: 'Ο κοινός κατάλογος ανήκει σε όλα τα γυμναστήρια και δεν αλλάζει από εδώ.',
    createTitle: 'Νέα άσκηση',
    createSubmit: 'Προσθήκη άσκησης',
    nameElRequired: 'Το ελληνικό όνομα είναι υποχρεωτικό — αυτό βλέπουν οι προπονητές.',
    createFailed: 'Η άσκηση δεν αποθηκεύτηκε. Ίσως υπάρχει ήδη άσκηση με αυτό το όνομα.',
    createDone: 'Η άσκηση προστέθηκε.',
    loadFailed: 'Ο κατάλογος ασκήσεων δεν φορτώθηκε.',
    restSeconds: '{{seconds}} δευτ.',
    /** The archive is soft, so the way back is an undo — but only where the repository can
        genuinely restore the row. Where it cannot, the screen keeps the confirm and says
        `archiveOneWay` instead of offering a button that does nothing. */
    archiveUndone: 'Η άσκηση επανήλθε.',
    archiveUndoFailed: 'Η επαναφορά δεν έγινε — η άσκηση παραμένει αρχειοθετημένη.',
    restoreAction: 'Επαναφορά άσκησης',
  },

  team: {
    title: 'Ομάδα',
    roster: 'Σύνθεση',
    invite: 'Πρόσκληση προπονητή',
    inviteEmail: 'Email προπονητή',
    sendInvite: 'Αποστολή',
    pendingInvites: 'Εκκρεμείς προσκλήσεις',
    noPending: 'Καμία εκκρεμής πρόσκληση',
    inviteCode: 'Κωδικός',
    copyLink: 'Αντιγραφή συνδέσμου',
    linkCopied: 'Ο σύνδεσμος αντιγράφηκε',
    /** The secret exists once, in the response that mints it. Say so where it is shown. */
    inviteShownOnce: 'Ο σύνδεσμος εμφανίζεται μία μόνο φορά. Αντίγραψέ τον τώρα.',
    invitedBy: 'από',
    revoke: 'Ανάκληση',
    removeConfirm: 'Διαγραφή προπονητή;',
    lastOwner: 'Πρέπει να μείνει ένας ιδιοκτήτης.',
    subtitle: 'Ποιος γράφει στο φύλλο του γυμναστηρίου.',
    loadFailed: 'Η ομάδα δεν φορτώθηκε.',
    ownerOnly: 'Μόνο ο ιδιοκτήτης',
    ownerOnlyHint:
      'Μόνο ο ιδιοκτήτης προσκαλεί προπονητές, αλλάζει ρόλους και αφαιρεί μέλη. Μπορείς να καταγράφεις προπονήσεις για κάθε αθλητή του γυμναστηρίου.',
    inviteRole: 'Ρόλος στο γυμναστήριο',
    inviteLink: 'Σύνδεσμος πρόσκλησης',
    inviteCreated: 'Η πρόσκληση δημιουργήθηκε',
    /** The server stores sha256(secret). There is no second read, so the copy has to say it
        before the coach closes the sheet, not after. */
    inviteOnceWarning:
      'Ο διακομιστής κρατά μόνο τη σύνοψή του. Αυτή είναι η μοναδική φορά που εμφανίζεται — αν χαθεί, ανακάλεσε την πρόσκληση και φτιάξε νέα.',
    inviteEmailRequired: 'Γράψε το email του προπονητή.',
    inviteEmailInvalid: 'Αυτό δεν μοιάζει με διεύθυνση email.',
    inviteFailed: 'Η πρόσκληση δεν δημιουργήθηκε. Χρειάζεται σύνδεση με τον διακομιστή.',
    copyFailed: 'Ο browser δεν επέτρεψε την αντιγραφή. Επίλεξε τον σύνδεσμο και αντίγραψέ τον.',
    expires: 'Λήγει {{date}}',
    openInvite: 'Ανοιχτός σύνδεσμος (χωρίς email)',
    revokeDone: 'Η πρόσκληση ανακλήθηκε.',
    revokeFailed: 'Η ανάκληση δεν αποθηκεύτηκε. Δοκίμασε ξανά.',
    removeTrainer: 'Αφαίρεση προπονητή',
    removeExplain:
      'Χάνει την πρόσβαση στο γυμναστήριο. Ό,τι έχει καταγράψει μένει στο όνομά του — η ιστορία δεν ξαναγράφεται.',
    removeDone: 'Ο προπονητής αφαιρέθηκε.',
    removeFailed: 'Η αφαίρεση δεν αποθηκεύτηκε. Δοκίμασε ξανά.',
    transfer: 'Μεταβίβαση ιδιοκτησίας',
    transferTo: 'Μεταβίβαση σε {{name}}',
    transferChoose: 'Νέος ιδιοκτήτης',
    transferExplain:
      'Ο/Η {{name}} γίνεται ιδιοκτήτης και εσύ γίνεσαι προπονητής. Δεν μπορείς να το αναιρέσεις μόνος σου — μόνο ο νέος ιδιοκτήτης μπορεί να σου δώσει πίσω τον ρόλο.',
    transferConfirmWord: 'ΜΕΤΑΒΙΒΑΣΗ',
    transferTypeHint: 'Γράψε «{{word}}» για να επιβεβαιώσεις.',
    transferMismatch: 'Η λέξη δεν ταιριάζει.',
    transferNoCandidates: 'Δεν υπάρχει άλλο ενεργό μέλος για να αναλάβει το γυμναστήριο.',
    transferDone: 'Η ιδιοκτησία μεταβιβάστηκε.',
    transferFailed: 'Η μεταβίβαση δεν ολοκληρώθηκε. Τίποτα δεν άλλαξε.',
    /** The two-step transfer can land half-applied. Saying so is the only way the ex-owner
        knows the gym now has two owners and who has to fix it. */
    transferHalfDone:
      'Ο/Η {{name}} έγινε ιδιοκτήτης, αλλά ο δικός σου ρόλος δεν άλλαξε. Ζήτησέ του να τον αλλάξει.',
  },

  calendar: {
    title: 'Ημερολόγιο',
    subtitle: 'Προσωπικές προπονήσεις ανά μέλος.',
    schedule: 'Πρόγραμμα',
    newAppointment: 'Νέο ραντεβού',
    editAppointment: 'Ραντεβού',
    scheduleSession: 'Προγραμματισμός',
    sessionType: 'Τύπος',
    duration: 'Διάρκεια',
    chooseAthlete: 'Επιλογή αθλητή',
    chooseCoach: 'Επιλογή προπονητή',
    today: 'Σήμερα',
    upcoming: 'Επερχόμενα',
    nothingScheduled: 'Κανένα ραντεβού',
    nothingScheduledHint: 'Πάτα + για να κλείσεις προπόνηση.',
    markDone: 'Ολοκλήρωση',
    completed: 'Ολοκληρώθηκε',
    scheduled: 'Προγραμματισμένο',
    startSession: 'Έναρξη προπόνησης',
    week: 'Εβδομάδα',
    previousWeek: 'Προηγούμενη εβδομάδα',
    nextWeek: 'Επόμενη εβδομάδα',
    jumpToToday: 'Μετάβαση στη σημερινή μέρα',
    athlete: 'Αθλητής',
    coach: 'Προπονητής',
    dayEmpty: 'Τίποτα κλεισμένο αυτή τη μέρα',
    openAppointment: 'Άνοιγμα ραντεβού',
    openSession: 'Άνοιγμα προπόνησης',
    deleted: 'Το ραντεβού διαγράφηκε',
    noAthletes: 'Πρόσθεσε πρώτα έναν αθλητή.',
  },

  settings: {
    title: 'Ρυθμίσεις',
    gymName: 'Όνομα γυμναστηρίου',
    gymWorkspace: 'Χώρος γυμναστηρίου',
    timezone: 'Ζώνη ώρας',
    displayUnit: 'Μονάδα βάρους',
    appearance: 'Εμφάνιση',
    theme: 'Θέμα',
    themeSystem: 'Συσκευή',
    themeDaylight: 'Φωτεινό',
    themeSlate: 'Σκούρο',
    language: 'Γλώσσα',
    dataExport: 'Δεδομένα & εξαγωγή',
    exportCsv: 'Εξαγωγή CSV',
    exportJson: 'Εξαγωγή JSON',
    about: 'Σχετικά',
    version: 'Έκδοση',
    ownerOnlyGym: 'Μόνο ο ιδιοκτήτης αλλάζει τα στοιχεία του γυμναστηρίου.',
    gymNameRequired: 'Το γυμναστήριο χρειάζεται όνομα.',
    gymSaved: 'Αποθηκεύτηκε.',
    gymSaveFailed: 'Το όνομα δεν αποθηκεύτηκε. Δοκίμασε ξανά.',
    unitKg: 'kg',
    unitLb: 'lb',
    storageTitle: 'Πού μένουν τα δεδομένα',
    /** Honesty, not a disclaimer: with no server there is nothing to sync, and a coach who
        believes otherwise loses three months of sheets when the browser clears its storage. */
    storageLocalBody:
      'Δεν έχει ρυθμιστεί διακομιστής. Ό,τι καταγράφεις μένει μόνο σε αυτή τη συσκευή και σε αυτόν τον browser — δεν συγχρονίζεται και δεν το βλέπει άλλος προπονητής.',
    storageLocalHint: 'Κάνε εξαγωγή πριν καθαρίσεις τα δεδομένα του browser.',
    storageServerBody:
      'Τα δεδομένα αποθηκεύονται στον διακομιστή του γυμναστηρίου. Ό,τι γράφεις εκτός δικτύου μπαίνει σε ουρά και στέλνεται μόλις επανέλθει η σύνδεση.',
    resetDemo: 'Επαναφορά δεδομένων επίδειξης',
    resetDemoHint:
      'Σβήνει ό,τι έχεις καταγράψει εδώ και ξαναφτιάχνει το γυμναστήριο-δείγμα με τους 5 αθλητές του.',
    resetDemoConfirm: 'Επαναφορά; Ό,τι έγραψες σε αυτή τη συσκευή χάνεται.',
    resetDone: 'Τα δεδομένα επίδειξης επανήλθαν.',
    resetFailed: 'Η επαναφορά απέτυχε.',
    exportCsvHint:
      'Για Excel: UTF-8 με BOM και ερωτηματικό ως διαχωριστικό, ώστε να ανοίγει σε στήλες σε ελληνικά Windows.',
    exportJsonHint: 'Πλήρες αντίγραφο κάθε γραμμής του γυμναστηρίου.',
    exportDone: 'Το αρχείο {{file}} κατέβηκε.',
    exportEmpty: 'Δεν υπάρχει καμία καταγεγραμμένη προπόνηση για εξαγωγή.',
    exportFailed: 'Η εξαγωγή απέτυχε. Δοκίμασε ξανά ή άνοιξε την εφαρμογή εκτός ιδιωτικής περιήγησης.',
    accountDemo: 'Σε λειτουργία επίδειξης δεν υπάρχει λογαριασμός.',
    signOutHint: 'Καθαρίζει τα προσωρινά δεδομένα αυτής της συσκευής.',
    /** Which backend is live, said in words a coach can act on. "Επίδειξη" is not a
        disclaimer here: it is the difference between data that exists in one browser and data
        the gym owns. */
    mode: 'Λειτουργία',
    modeDemo: 'Επίδειξη — μόνο σε αυτή τη συσκευή',
    modeConnected: 'Συνδεδεμένο στον διακομιστή του γυμναστηρίου',
    project: 'Έργο',
    projectUnknown: 'Δεν έχει δηλωθεί διεύθυνση έργου.',
    region: 'Περιοχή',
    /** Said, never guessed: a `*.supabase.co` URL does not carry a region, and a guess here
        would be a data-residency claim nobody checked. */
    regionUnknown: 'Δεν δηλώνεται από τη διεύθυνση του έργου.',
    syncSection: 'Αποθήκευση & αποστολή',
    /** Typed, not tapped: the reset erases everything written on this device, and no toast
        can undo it afterwards. */
    resetTyped: 'Επιβεβαίωση',
    resetConfirmWord: 'ΕΠΑΝΑΦΟΡΑ',
    resetTypeHint: 'Γράψε «{{word}}» για να επιβεβαιώσεις.',
    resetMismatch: 'Η λέξη δεν ταιριάζει.',
  },

  progress: {
    title: 'Πρόοδος',
    byExercise: 'Ανά άσκηση',
    byBodyPart: 'Ανά μυϊκή ομάδα',
    est1rm: 'Εκτ. 1RM',
    maxReps: 'Μέγ. επαν.',
    best: 'Καλύτερο',
    latest: 'Τρέχον',
    change: 'Μεταβολή',
    volumeShare: 'Κατανομή όγκου',
    trend: 'Τάση',
    needMoreData: 'Κατέγραψε μερικές προπονήσεις για να δεις τάσεις.',
    oneDataPoint: 'Μία προπόνηση — η τάση εμφανίζεται μετά την επόμενη.',
    /** The prototype called this "κατανομή όγκου" while plotting set counts. It plots sets. */
    setShare: 'Σετ ανά μυϊκή ομάδα',
    setShareHint: 'Μετράει σετ, όχι κιλά.',
    weeklyVolume: 'Όγκος ανά εβδομάδα',
    weekOf: 'Εβδομάδα {{date}}',
    noExercises: 'Καμία καταγεγραμμένη άσκηση',
    noExercisesHint: 'Οι τάσεις εμφανίζονται μετά την πρώτη προπόνηση.',
  },

  /**
   * Notes are append-only, and the copy has to say so: a trainer who expects to edit one
   * writes half a correction and leaves the wrong half standing.
   */
  notes: {
    title: 'Σημειώσεις',
    add: 'Προσθήκη σημείωσης',
    placeholder: 'Τι πρέπει να ξέρει ο επόμενος προπονητής;',
    save: 'Καταχώριση',
    pin: 'Καρφίτσωμα',
    pinned: 'Καρφιτσωμένη',
    unpin: 'Ξεκαρφίτσωμα',
    dismiss: 'Απόκρυψη',
    dismissed: 'Αποκρύφθηκε',
    empty: 'Καμία σημείωση ακόμα',
    appendOnly: 'Οι σημειώσεις δεν αλλάζουν. Μια διόρθωση γράφεται ως νέα σημείωση.',
    /** Ten seconds, wet hands, athlete still on the bench. */
    dictationHint: 'Βρεγμένα χέρια; Πάτα το μικρόφωνο στο πληκτρολόγιο και υπαγόρευσέ τη.',
  },

  /**
   * A language is always named in its own language, so these are identical in `en.ts` on
   * purpose. The prototype labelled Greek "GR" — a country code, and the wrong one to boot:
   * the language is ΕΛ (ελληνικά), GR is the country. Nobody switching to Greek reads English.
   */
  language: {
    el: 'Ελληνικά',
    en: 'English',
    elShort: 'ΕΛ',
    enShort: 'EN',
  },

  categories: {
    upper: 'Άνω σώμα',
    lower: 'Κάτω σώμα',
    core: 'Κορμός',
    cardio: 'Αερόβιο',
    mobility: 'Κινητικότητα',
  },

  equipmentTypes: {
    barbell: 'Μπάρα',
    dumbbell: 'Αλτήρες',
    machine: 'Μηχάνημα',
    cable: 'Τροχαλία',
    bodyweight: 'Σωματικό βάρος',
    cardio: 'Αερόβιο',
    kettlebell: 'Kettlebell',
    other: 'Άλλο',
  },

  /** Named for what a coach measures, because a `bodyweight` set has no kilos to total. */
  setKinds: {
    weight_reps: 'Βάρος × επαναλήψεις',
    bodyweight: 'Σωματικό βάρος',
    duration: 'Χρόνος',
    distance: 'Απόσταση',
  },

  apptTypes: {
    personal: 'Προσωπική',
    assessment: 'Αξιολόγηση',
    group: 'Ομαδικό',
    program: 'Έλεγχος προγράμματος',
  },

  roles: {
    owner: 'Ιδιοκτήτης',
    trainer: 'Προπονητής',
  },

  statuses: {
    invited: 'Προσκλήθηκε',
    active: 'Ενεργός',
    removed: 'Αφαιρέθηκε',
  },

  csv: {
    date: 'Ημερομηνία',
    gym: 'Γυμναστήριο',
    athlete: 'Αθλητής',
    trainer: 'Προπονητής',
    workout: 'Προπόνηση',
    category: 'Κατηγορία',
    exercise: 'Άσκηση',
    set: 'Σετ',
    kg: 'Κιλά',
    reps: 'Επαν.',
    notes: 'Σημειώσεις',
    /** Without these two columns a treadmill or a plank exports as a blank row — the same
        silent loss the four `SetKind`s exist to prevent. */
    seconds: 'Δευτ.',
    meters: 'Μέτρα',
    rpe: 'RPE',
  },

  /** Copy for the routed stubs. It says what is missing and when it arrives — never fake data. */
  placeholder: {
    badge: 'Δεν έχει χτιστεί ακόμα',
    body: 'Η οθόνη υπάρχει για να δουλεύει η πλοήγηση. Το περιεχόμενό της γράφεται στο {{milestone}}.',
    noData: 'Δεν εμφανίζονται πραγματικά δεδομένα εδώ.',
    routeParams: 'Παράμετροι διαδρομής',
    /** One line per screen on what the finished thing does. Named, not generic. */
    screens: {
      athletes: 'Η λίστα των αθλητών, με αναζήτηση και την τελευταία τους προπόνηση.',
      athlete: 'Η κάρτα ενημέρωσης, τα στατιστικά και το ιστορικό προπονήσεων ενός αθλητή.',
      log: 'Η καταγραφή της προπόνησης: μπλοκ ασκήσεων, σετ, όγκος και χρονόμετρο.',
      calendar: 'Εβδομαδιαία προβολή με τα ραντεβού και τις προσωπικές προπονήσεις.',
      library: 'Ο κατάλογος ασκήσεων, με φίλτρα κατηγορίας και εξοπλισμού.',
      team: 'Οι προπονητές του γυμναστηρίου, οι ρόλοι τους και οι προσκλήσεις.',
      settings: 'Γυμναστήριο, εμφάνιση, γλώσσα, εξαγωγή δεδομένων και λογαριασμός.',
      auth: 'Σύνδεση με κωδικό μιας χρήσης στο email σου.',
      join: 'Είσοδος σε γυμναστήριο μέσω συνδέσμου πρόσκλησης.',
    },
  },

  /**
   * What has and has not been saved.
   *
   * Every string here is read as a promise, so none of them may be generous. "Αποθηκεύτηκε"
   * appears only where a write is genuinely at rest — on the server, or, in demo mode, on the
   * one phone that holds it — and never next to work still sitting in a queue. The prototype's
   * "Auto-saved" toast fired from a button that saved nothing; that is the one lie this app
   * cannot afford, because a coach who believes it stops re-checking.
   */
  sync: {
    label: 'Κατάσταση αποθήκευσης',
    /** No server exists in this mode. The sentence names the phone and stops there. */
    local: 'Αποθηκεύτηκε σε αυτό το κινητό',
    localBody:
      'Μόνο εδώ, σε αυτόν τον browser. Δεν στέλνεται πουθενά, δεν το βλέπει άλλος προπονητής και χάνεται αν καθαριστούν τα δεδομένα του browser.',
    saved: 'Αποθηκεύτηκε στον διακομιστή',
    savedBody: 'Δεν εκκρεμεί καμία αλλαγή.',
    sending: 'Αποστολή…',
    pending_one: '{{count}} αλλαγή σε αναμονή',
    pending_other: '{{count}} αλλαγές σε αναμονή',
    pendingBody: 'Γραμμένες σε αυτό το κινητό, όχι ακόμη στον διακομιστή.',
    offline: 'Εκτός σύνδεσης',
    offlineBody: 'Ό,τι γράφεις μπαίνει στην ουρά και φεύγει μόλις επανέλθει το δίκτυο.',
    failed_one: '{{count}} αλλαγή δεν στάλθηκε',
    failed_other: '{{count}} αλλαγές δεν στάλθηκαν',
    /** An op is applied or it is here, where a human can see it. It is never dropped and never
        retried forever — a queue that does either stops working without saying so. */
    failedBody:
      'Ο διακομιστής τις απέρριψε. Μένουν εδώ μέχρι να τις ξαναστείλεις: τίποτα δεν σβήνεται από μόνο του και τίποτα δεν ξαναδοκιμάζεται στο άπειρο.',
    retry: 'Ξαναστείλε',
    retryAll: 'Ξαναστείλε τες',
    requeued_one: '{{count}} αλλαγή μπήκε ξανά στην ουρά.',
    requeued_other: '{{count}} αλλαγές μπήκαν ξανά στην ουρά.',
    discard: 'Οριστική απόρριψη',
    discarded: 'Η αλλαγή απορρίφθηκε οριστικά.',
    queueTitle: 'Ουρά αποστολής',
    deadTitle: 'Απορρίφθηκαν από τον διακομιστή',
    reason: 'Αιτία',
    lastError: 'Τελευταίο σφάλμα',
  },

  /**
   * Strings the primitives in `src/ui/` own.
   *
   * They live here rather than as component defaults for the usual reason, plus one specific to
   * them: an `aria-label` is a UI string that never appears on screen, so a hardcoded English
   * one is invisible in review and audible only to the trainer using VoiceOver in Greek.
   */
  ui: {
    dismiss: 'Απόρριψη',
    notifications: 'Ειδοποιήσεις',
    rowActions: 'Ενέργειες γραμμής',
    increase: 'Αύξηση',
    decrease: 'Μείωση',
    increaseBy: 'Αύξηση κατά {{amount}}',
    decreaseBy: 'Μείωση κατά {{amount}}',
    keypad: 'Αριθμητικό πληκτρολόγιο',
    digit: 'Ψηφίο {{digit}}',
    /** The Greek decimal separator. The pad emits a comma because that is what is typed here. */
    decimalComma: 'Υποδιαστολή',
    backspace: 'Διαγραφή ψηφίου',
    recentLoads: 'Πρόσφατα',
    commit: 'Καταχώριση',
    invalidNumber: 'Μη έγκυρος αριθμός',
    noValue: 'Χωρίς τιμή',
  },

  errors: {
    notFoundTitle: 'Η σελίδα δεν βρέθηκε',
    notFoundBody: 'Ο σύνδεσμος δεν αντιστοιχεί σε οθόνη της εφαρμογής.',
    genericTitle: 'Κάτι πήγε στραβά',
    genericBody: 'Δοκίμασε ξανά. Αν επιμείνει, κλείσε και ξανάνοιξε την εφαρμογή.',
    backToAthletes: 'Πίσω στους αθλητές',
  },

  /**
   * The A4 sheet. Printing is what the gym falls back to when a phone dies mid-session, so the
   * blank variant is a first-class choice and not a consolation prize: it is the one thing the
   * paper sheet still does better.
   */
  print: {
    action: 'Εκτύπωση',
    chooseTitle: 'Εκτύπωση φύλλου',
    filled: 'Φύλλο αθλητή',
    filledHint: 'Οι τελευταίες προπονήσεις, με προπονητή και ημερομηνία σε κάθε γραμμή.',
    blank: 'Κενό φύλλο',
    blankHint: 'Γραμμογραφημένο, για το πάτωμα όταν πέσει το κινητό.',
    blankTitle: 'Κενό φύλλο προπόνησης',
    setNo: 'Σετ {{index}}',
    printedAt: 'Εκτυπώθηκε {{date}}',
    transcribe: 'Μετάφερε τις γραμμές στο TrainHub μετά την προπόνηση.',
  },

  /**
   * Strings that exist only for assistive tech and the keyboard. Nothing here is decoration:
   * the skip link is the one control a coach on a keyboard needs before any other, because a
   * screen's header — back, search, print — otherwise sits between them and the list.
   */
  a11y: {
    skipToContent: 'Μετάβαση στο περιεχόμενο',
    /** The scroll region's name on a screen that passed no title of its own. */
    mainContent: 'Περιεχόμενο οθόνης',
  },
}

/**
 * The resource shape. `en.ts` is annotated with it, and `TranslationKey` in `./index.ts` is
 * derived from it, so both languages and every `t()` call move together.
 */
export type Translation = typeof el
