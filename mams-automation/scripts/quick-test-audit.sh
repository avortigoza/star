#!/bin/sh
# quick-test-audit.sh
#
# FOR TESTING ONLY - not for production/monthly use.
#
# Your real script scans everything under /Volumes/snibmprod and
# /Volumes/snibmfs5kprod (which is why it takes ~6 hours), and also builds
# Vizone_All_Mats_*.csv / Ardome_All_Mats_*.csv via a recursive `ls -lR`
# over every file - neither of those two are read by push-to-mams.js, so
# this test script skips them entirely.
#
# This only scans the first 5 top-level items in each volume, so it
# finishes in well under a minute, then pushes whatever it found - letting
# you confirm the real scan -> CSV -> push -> app pipeline actually works,
# without waiting for a full run.

loc=/Users/postmams/Documents/scripts/audit_storage/data
mkdir -p "$loc"

echo 'Checking disk storage at snibmprod (TEST MODE - first 5 items only)'
ls -d /Volumes/snibmprod/*/ /Volumes/snibmprod/* 2>/dev/null | sort -u | head -5 | xargs du -sk 2>/dev/null | awk '{print $1","$2}' | tee "$loc/IBM.csv"

echo 'Checking disk storage at snibmfs5kprod (TEST MODE - first 5 items only)'
ls -d /Volumes/snibmfs5kprod/*/ /Volumes/snibmfs5kprod/* 2>/dev/null | sort -u | head -5 | xargs du -sk 2>/dev/null | awk '{print $1","$2}' | tee "$loc/COMP.csv"

automation="/Users/postmams/Documents/scripts/audit_storage/mams-automation"
echo 'Pushing IBM data to MAMS Storage Audit app'
node "$automation/scripts/push-to-mams.js" IBM "$loc/IBM.csv"
echo 'Pushing COMP data to MAMS Storage Audit app'
node "$automation/scripts/push-to-mams.js" COMP "$loc/COMP.csv"
