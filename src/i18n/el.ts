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
  },

  picker: {
    title: 'Επιλογή άσκησης',
    searchOrType: 'Αναζήτηση ή πληκτρολόγησε άσκηση…',
    noMatches: 'Καμία αντιστοιχία',
    addCustomHint: 'Πρόσθεσέ τη ως δική σου άσκηση',
    create: 'Δημιουργία',
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
}

/**
 * The resource shape. `en.ts` is annotated with it, and `TranslationKey` in `./index.ts` is
 * derived from it, so both languages and every `t()` call move together.
 */
export type Translation = typeof el
