import { appendFileSync } from "fs";

// semantic-release `successCmd` hook: expose the published release to the GitHub
// Actions job as step outputs (`released`, `version`) so downstream jobs (website
// deploy) can gate on a release actually happening. Shell parameter expansion can't
// be used in exec cmd strings (they run through lodash templates, which treat
// `${...}` as JS), hence this script. No-op outside GitHub Actions.

const version = process.argv[2];
if (!version) throw new Error("version argument required");

const outputFile = process.env.GITHUB_OUTPUT;
if (!outputFile) {
  console.log(`release-success: GITHUB_OUTPUT not set; skipping (version ${version})`);
} else {
  appendFileSync(outputFile, `released=true\nversion=${version}\n`);
  console.log(`release-success: wrote released=true, version=${version}`);
}
