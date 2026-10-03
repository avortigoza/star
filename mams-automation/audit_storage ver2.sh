#!/bin/sh

# audit_storage.sh
# 
#
# Created by MAMS_IMAC on 1/30/19.
# Copyright 2019 __MyCompanyName__. All rights reserved.
loc=/Users/postmams/Documents/scripts/audit_storage/data
mkdir -p $loc

#echo 'Gathered storage quota'
#echo "DATE,$(date)" > $loc/VIZONE_QUOTA.csv
#echo 'SHOW,STORAGE,TOTAL,FREE,USED,TOTAL(BYTE),FREE(BYTE)' >> $loc/VIZONE_QUOTA.csv
#cat /Users/postmams/Documents/scripts/VIZONE_QUOTA/VIZONE_QUOTA.htm | grep "                            data-value" | grep "|hr1|" | sed -e 's/                            data\-value\=//g' | sed -e 's/\"//g' | sed -e 's/\|\|/\,/g' >> $loc/VIZONE_QUOTA.csv
#cat /Users/postmams/Documents/scripts/VIZONE_QUOTA/VIZONE_QUOTA.htm | grep "                            data-value" | grep "|clone-hr1|" | sed -e 's/                            data\-value\=//g' | sed -e 's/\"//g' | sed -e 's/\|\|/\,/g' >> $loc/VIZONE_QUOTA.csv

echo 'Checking disk storage at snibmprod'
du -sk /Volumes/snibmprod/* | awk '{print $1","$2}' | tee $loc/IBM.csv
echo 'Checking disk storage at snibmprod/media'
du -sk /Volumes/snibmprod/media/* | awk '{print $1","$2}' | tee -a $loc/IBM.csv
#echo 'Checking disk storage at snibmprod/prod_hr2'
#du -sk /Volumes/snibmprod/prod_hr2/* | awk '{print $1","$2}' | tee -a $loc/IBM.csv
echo 'Checking disk storage at snibmprod/prod_hr2'
du -sk /Volumes/snibmprod/prod_hr2/* | awk '{print $1","$2}' | tee -a $loc/IBM.csv
echo 'Checking disk storage at snibmprod/media/hr/hr1'
du -sk /Volumes/snibmprod/media/hr/hr1/* | awk '{print $1","$2}' | tee -a $loc/IBM.csv


echo 'Checking disk storage at snibmfs5kprod'
du -sk /Volumes/snibmfs5kprod/* | awk '{print $1","$2}' | tee $loc/COMP.csv
echo 'Checking disk storage at snibmfs5kprod/media'
du -sk /Volumes/snibmfs5kprod/media/* | awk '{print $1","$2}' | tee -a $loc/COMP.csv
echo 'Checking disk storage at snibmfs5kprod/prod_hr3'
du -sk /Volumes/snibmfs5kprod/prod_hr3/* | awk '{print $1","$2}' | tee -a $loc/COMP.csv
echo 'Checking disk storage at snibmfs5kprod/media/hr/hr1'
du -sk /Volumes/snibmfs5kprod/media/hr/hr1/* | awk '{print $1","$2}' | tee -a $loc/COMP.csv


echo 'Gathering Data at snibmprod/media/hr/hr1'
ls -lR /Volumes/snibmprod/media/hr/hr1/* | grep -e ".mxf" -e ".mov" | awk '{print $5","$9}' | grep -v 'mxf-op1a' | tee $loc/Vizone_All_Mats_IBM.csv
echo 'Gathering Data at snibmfs5kprod/media/hr/hr1'
ls -lR /Volumes/snibmfs5kprod/media/hr/hr1/* | grep -e ".mxf" -e ".mov" | awk '{print $5","$9}' | grep -v 'mxf-op1a' | tee $loc/Vizone_All_Mats_COMP.csv
echo 'Gathering Data at /snibmprod/prod_hr2'
ls -lR /Volumes/snibmprod/prod_hr2 | grep -e .mxf -e .mov -e .wav -e .aiff -e "_" | grep -v prod_hr | awk '{print $9","$5}' | tee $loc/Ardome_All_Mats_IBM.csv
echo 'Gathering Data at /snibmfs5kprod/prod_hr3'
ls -lR /Volumes/snibmfs5kprod/prod_hr3 | grep -e .mxf -e .mov -e .wav -e .aiff -e "_" | grep -v prod_hr | awk '{print $9","$5}' | tee $loc/Ardome_All_Mats_COMP.csv

# ---- Added: push freshly-generated IBM.csv / COMP.csv to the MAMS Storage
# ---- Audit web app, same effect as clicking Import in the browser.
automation="/Users/postmams/Documents/scripts/audit_storage/mams-automation"
# Uses plain curl (Apple-signed, kept working both times Node on this Mac
# lost the ability to reach the VM with EHOSTUNREACH - incl. the Sep 30
# month-end run) to upload the raw CSV; the STAR server does the parsing
# (POST /api/ingest/:side). Retries for ~5 min before giving up.
MAMS_API_URL="${MAMS_API_URL:-http://10.0.1.50:8104}"
push_csv() {
  side="$1"; file="$2"
  echo "Pushing $side data to MAMS Storage Audit app"
  curl --fail --silent --show-error --max-time 60 \
       --retry 10 --retry-delay 30 --retry-all-errors \
       -H "Content-Type: text/csv" --data-binary @"$file" \
       "$MAMS_API_URL/api/ingest/$side" >> "$automation/logs/push.log" 2>&1
  rc=$?
  echo >> "$automation/logs/push.log"   # server's JSON reply has no trailing newline
  if [ $rc -eq 0 ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Pushed $side from $file via curl" >> "$automation/logs/push.log"
  else
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] PUSH FAILED for $side from $file via curl" >> "$automation/logs/push.log"
    echo "PUSH FAILED for $side - see $automation/logs/push.log"
  fi
}
push_csv IBM "$loc/IBM.csv"
push_csv COMP "$loc/COMP.csv"
