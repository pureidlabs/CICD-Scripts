const openpgp = require('openpgp');
const fetch = require('node-fetch');

var cachedKeys = new Map();

// Read ENV variables
const accessToken = process.env.ACCESS_TOKEN;
const orgID = process.env.ORG_ID;
const apiUrl = process.env.SERVER_API_URL;
const ignoreCommitsStart = process.env.IGNORE_COMMITS_START;
const maxFailCount = parseInt(process.env.MAX_FAIL_COUNT, 10) || 0;
const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
const commitExceptionsHashes = parseCommitExceptionHashesList();

function parseCommitExceptionHashesList () {
    let hashes = process.env.COMMIT_EXCEPTIONS_HASHES;
    let parsedHashList = []
    if (hashes) {
        let commaSeparated = hashes.split(",");
        commaSeparated.forEach(hash=>{
            parsedHashList.push(hash.trim())
        })
    }
    return parsedHashList;
}


class Key {
    constructor (keyID) {
        this.keyID = keyID
        this.publicKey = null
        this.error = null
    }

    async fetchPublicKey(apiUrl, accessToken, orgId) {
        try {
            const data = {
                "keyid": this.keyID
            }
            const headersSet = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Access-Token': accessToken,
                'Organization-Id': orgId
            }
            const resp = await fetch(apiUrl, {
                headers: headersSet,
                method: "POST",
                body: JSON.stringify(data)
            })
            const response = await resp.json();
            if (response.status != "success"){
                if (response.code == 1175) {
                    this.error = "Key is not registered in PureAUTH.";
                } else {
                    this.error = response.user_error
                }
            } else {
                this.publicKey = response.data.publickey
            }
        } catch (err) {
            this.error = err.toString()
        }
    }
}

class Commit {
    constructor(commitHash, commitData) {
        this.hash = commitHash;
        this.object = commitData;
        this.signature = null;
        this.key = null;
        this.payload = null;
        this.verified = false;
        this.error = null;
    }

    async parseSignature() {
        let _signature = this.object.substring(
            this.object.indexOf("-----BEGIN PGP SIGNATURE-----"),
            this.object.lastIndexOf("-----END PGP SIGNATURE-----")
        );
        let sigArray = _signature.split("\n");
        for (let i=0; i<sigArray.length; i++) {
            sigArray[i] = sigArray[i].trim();
        }
        _signature = sigArray.join("\n") + "\n-----END PGP SIGNATURE-----";
        try {            
            const signatureObject = await openpgp.readSignature({
                armoredSignature: _signature // parse detached signature
            });
            this.signature = signatureObject
            this.signatureParsed = true
            this.key = new Key(this.signature.getSigningKeyIDs()[0].toHex());
        } catch (error) {
            this.error = `Could not parse signature for commit ${this.hash}`;
        }
    }

    parsePayload(){
        let _payload = this.object.substring(
            this.object.indexOf("tree"), this.object.indexOf("gpgsig")
        )
       _payload += "\n" + this.object.substring(
            this.object.indexOf("-----END PGP SIGNATURE-----")+33,
            this.object.length-1
        ) + "\n";
        this.payload = _payload;
        this.payloadParsed = true;
    }

    async verify() {
        const pubKeyLoaded = await openpgp.readKey({ armoredKey: this.key.publicKey });
        const createdMessage = await openpgp.createMessage({ text: this.payload });
        const verificationResult = await openpgp.verify({
            message: createdMessage, // Message object
            signature: this.signature,
            verificationKeys: pubKeyLoaded
        });
        try{
            let verified = await verificationResult.signatures[0].verified;
            if (verified){
                this.verified = true;
            } else {
                this.error = "Bad Signature!";
            }
        } catch (err){
            this.error = err;
        }
    }
}

function splitCommits (data) {
    function getAllCommitHashes(data) {
        let hashes = []
        const matches = data.matchAll(/commit (.*)\ntree/g);
        const results = Array.from(matches);
        for (let result of results) {
            hashes.push(result[1])
        }
        return hashes
    }

    var commits = []
    const commitHashes = getAllCommitHashes(data);
    let commitObjects = data.split(/commit .*\ntree/g);
    commitObjects.shift()
    commitObjects.forEach((value, i) => {
        // Git adds an extra newline between commit blobs, remove it.
        let commitObject = value;
        if (i+1 != commitObjects.length) {
            commitObject = value.slice(0, -1);
        }
        // Regex removes "tree" at the start of line, reintroduce it
        let commitMessage = "tree" + commitObject;
        let commit = new Commit(commitHashes[i], commitMessage)
        commits.push(commit);
    })
    return commits;
}

async function sendNotification(data) {
    try {
        if (webhookUrl == null) throw new Error("Webhook URL not found.");
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: data,
            }),
        });
        const _ = await response.json();
    } catch (error) {
        console.error('Error sending notification:', error.message);
    }
}

async function startCommitVerification(commits) {
    for (let commit of commits) {
        commit.parsePayload();
        await commit.parseSignature();
        if (commit.key) {
            loadedKeyFromCache = cachedKeys.get(commit.key.keyID);
            if (loadedKeyFromCache) {
                commit.key.publicKey = loadedKeyFromCache;
                await commit.verify();
            } else {
                await commit.key.fetchPublicKey(apiUrl, accessToken, orgID);
                if (commit.key.error == null) {
                    cachedKeys.set(commit.key.keyID, commit.key.publicKey);
                    await commit.verify();
                }
            }
        } else {
            commit.error = "Signature not found!"
        }
    }
}


process.stdin.on('data', data => {
    let notificationMessage = "";

    const commits = splitCommits(data.toString());
    if (commits.length == 0) process.exit(0);
    startCommitVerification(commits).then(() => {
        var failCount = 0;
        for (let commit of commits){
            if (commit.hash == ignoreCommitsStart) break;
            if (commitExceptionsHashes.includes(commit.hash)) continue;
            if (!commit.verified) failCount++;

            console.log("Commit: " + commit.hash);
            console.log("Signature Parsed: " + Boolean(commit.signature));
            console.log("Payload Parsed: " + Boolean(commit.payload));
            if (commit.key) {
                console.log("KeyID: " + commit.key.keyID);
                console.log("Public Key: " + Boolean(commit.key.publicKey));
                if (commit.key.error) {
                    console.log("KeyError: " + commit.key.error);
                }
            }
            if (commit.error) {
                console.log("Error: " + commit.error); 
            }
            
            console.log("Commit Verified: " + commit.verified);
            console.log("\n------------------------------------------------------\n"); 
        }
        if (failCount > maxFailCount) {
            // Send Fail notification.
            notificationMessage += "This message is being sent because a commit was not verified.\n"
            commits.forEach(commit => {
                notificationMessage += `\nCommit: ${commit.hash}\nSignature found: ${Boolean(commit.signature)}\n`
                if (commit.key) {
                    notificationMessage += `KeyID: ${commit.key.keyID}\nKey found on PureAUTH: ${Boolean(commit.key.publicKey)}\n`
                }
                notificationMessage += `Commit Verified: ${commit.verified}\n`
            });
            sendNotification(notificationMessage).then(_ => {
                throw new Error("Too many commits failed verification.")
            }).catch(err=>{
                console.log(err.toString())
                process.exit(1);
            });
        } else {
            console.log("Verification Complete!");
            // // Passed successfully, send notification.
            // notificationMessage = `Commit verification passed, top commit: ${commits[0].hash}`
            // sendNotification(notificationMessage);
        }

    }).catch(err => {
        console.log(err.toString());
        process.exit(1);
    })
});