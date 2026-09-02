"""What is actually running, so nobody has to guess.

The gym reported twice that a change was not there. The code was on `main` both
times; what nobody could tell from a phone was whether the deployed app had been
rebuilt from it yet, because a Streamlit Community Cloud app serves the last
build it made until it is rebooted or the push wakes it.

So the app says its own version out loud, on the sign-in screen and in
Ρυθμίσεις. "Λέει 5" from the gym and "5 is the one with the three lists" from
here settles in one message what otherwise costs a round of screenshots.

Hand-maintained on purpose: there is no build step to stamp a git SHA into, and
a number a person bumps deliberately is one a person can also say out loud.
"""

from __future__ import annotations

# Bump this in the same commit as any change the gym would notice.
VERSION = "6"

# What changed, newest first. Short enough that the whole list fits on a phone.
CHANGELOG: tuple[tuple[str, str], ...] = (
    ("6", "Και οι τρεις λίστες φαίνονται μαζί, από την αρχή."),
    ("5", "Τρεις λίστες: μυϊκή ομάδα → άσκηση → τρόπος. Επεξεργασία/διαγραφή αθλητή."),
    ("4", "«× σετ» για ίδια σετ με μία καταχώρηση."),
    ("3", "Ο εξοπλισμός φαίνεται παντού. Διόρθωση και διαγραφή προπόνησης."),
    ("2", "Αναζήτηση που φιλτράρει καθώς γράφεις."),
    ("1", "Πρώτη έκδοση για το γυμναστήριο."),
)
