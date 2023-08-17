# GITLAB SCRIPTS
These scripts work with the PureAUTH authentication platform to verify GPG signed commits in your CICD pipeline. To set these scripts up as jobs in your repository, follow the steps given below.

# Setup repository variables
All the variables that can be set are mentioned in the env-example file.
1) Go to the repository you want to add the CASS scripts to.
2) Go to settings -> CI/CD -> Variables -> Expand -> Add Variable.
3) The following are required repository variables:
    1) Set key as: **SERVER_API_URL** and the value as **https://live.pureauth.io/api/v1/organizations/employees/get-signing-key**
    2) Create another repository secret key: **ACCESS_TOKEN** value: **<Access token from PureAuth>**
    3) Set the **ORG_ID** key to your organization ID from PureAUTH.
    4) Set the **COMMITS_CHECK_COUNT** to set the number of commits to check going back from the current top commit.
4) Variable **MAX_FAIL_COUNT** is used to define how many commits are allowed to fail verification before the pipeline is aborted. Default is 0. E.g:
```bash
export MAX_FAIL_COUNT=0
```
5) Variable **IGNORE_COMMITS_START** is used to define the commit after which the verification of commits was enforced. The commits before this one (including this commit) will not be checked for GPG signatures. You can set it to the commit hash. E.g:
```bash
export IGNORE_COMMITS_START="798b7aac9a424af5fedbadc9231cb7c4b0eebce4"
```
6) Variable **COMMIT_EXCEPTIONS_HASHES** allows you to skip the verification of certain commits. E.g:
```bash
export COMMIT_EXCEPTIONS_HASHES="798b7aac9a424af5fedbadc9231cb7c4b0eebce4, 4b67491f8ba8adcbbe9aa062bc1ac09741e5d93a"
```
7) Variable **GOOGLE_CHAT_WEBHOOK_URL** can be set to get notifications to about pipeline failures to your google spaces. Set it to the google spaces webhook URL.

# Setup gitlab-pipelines.yml
1) Set the tag for the nodejs runner
2) Change the name of the job if required.
3) Add other jobs as required.
4) Please note that this script will only work on Nodejs runner.