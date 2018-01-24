#!/bin/bash

cd $(dirname "$0")

message_and_exit() {
  if [ "${SLACK_TOKEN}" = "" ]; then
    exit $1
  fi
  if [ "$2" = "" ]; then
    MESSAGE="${CI_PROJECT_URL}/-/jobs/${CI_JOB_ID} build failed."
  else
    MESSAGE=$2
  fi
  curl -k -XPOST -d "token=${SLACK_TOKEN}" -d "channel=#general" -d "text=${CI_PROJECT_NAME} (Mac) ${MESSAGE}" -d "username=GitLab CI" "https://slack.com/api/chat.postMessage"
  exit $1
}

rev=$(echo $(git log --oneline | wc -l))
commit=(`git log --oneline -1`)
echo "r$rev $commit"

if [ `uname` = 'Linux' ]; then
  dist=dist-linux
else
  dist=dist-mac
fi

npm --no-git-tag-version version 1.0.${rev} || message_and_exit 1
npm install || message_and_exit 1
npm run compile || message_and_exit 1

# workaround for https://github.com/electron-userland/electron-builder/issues/2013
if [ `uname` = 'Darwin' ]; then
  npm install --no-save 7zip-bin-mac
fi
npm run $dist || message_and_exit 1

message_and_exit 0 "build succeeded: ${CI_PROJECT_URL}/-/jobs/${CI_JOB_ID}/artifacts/browse/app/dist/"
