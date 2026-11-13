// Signing the desktop app's installers (docs/desktop.md, "Signing"), for
// scripts/desktop.mjs: when the environment holds a platform's signing
// settings, the build signs with them; when it holds none, the build is
// left unsigned, as on a developer's machine; when it holds only some, the
// build stops and names what's missing rather than quietly not signing.
//
// - Windows, Azure Artifact Signing: AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//   and AZURE_TENANT_ID (an App Registration allowed to sign), and
//   AZURE_SIGNING_ENDPOINT, AZURE_SIGNING_ACCOUNT and AZURE_SIGNING_PROFILE
//   (the account's endpoint, its name, and the certificate profile).
//   Signing runs artifact-signing-cli, which must be installed.
// - macOS, a Developer ID with notarization: APPLE_CERTIFICATE (the .p12,
//   base64) and APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY
//   ("Developer ID Application: Name (TEAMID)"), and APPLE_ID,
//   APPLE_PASSWORD (an app-specific password) and APPLE_TEAM_ID.

/** The settings each platform signs with, all needed. */
export const SIGNING = {
  win32: [
    "AZURE_CLIENT_ID",
    "AZURE_CLIENT_SECRET",
    "AZURE_TENANT_ID",
    "AZURE_SIGNING_ENDPOINT",
    "AZURE_SIGNING_ACCOUNT",
    "AZURE_SIGNING_PROFILE",
  ],
  darwin: ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"],
};

/**
 * How to build on `platform` given `env`:
 * - `env`: the environment for the Tauri CLI, without empty signing
 *   settings (CI passes an unset secret as ""; Tauri would take an empty
 *   APPLE_CERTIFICATE for one and fail importing it);
 * - `config`: what to merge into tauri.conf.json to sign, or null;
 * - `missing`: the settings lacking when only some are there.
 */
export function signing(env, platform) {
  const names = SIGNING[platform] ?? [];
  const clean = { ...env };
  for (const name of names) if (!clean[name]?.trim()) delete clean[name];
  const present = names.filter((name) => name in clean);
  if (present.length === 0) return { env: clean, config: null, missing: [] };
  const missing = names.filter((name) => !(name in clean));
  if (missing.length > 0) return { env: clean, config: null, missing };
  if (platform === "win32") {
    const args = ["-e", clean.AZURE_SIGNING_ENDPOINT.trim(), "-a", clean.AZURE_SIGNING_ACCOUNT.trim(), "-c", clean.AZURE_SIGNING_PROFILE.trim()];
    // The description is what an .msi's UAC prompt shows.
    args.push("-d", "The Dawn Project", "%1");
    return { env: clean, config: { bundle: { windows: { signCommand: { cmd: "artifact-signing-cli", args } } } }, missing: [] };
  }
  // The Developer ID in place of the ad hoc signature ("-") that unsigned
  // builds get; Tauri imports the certificate into a keychain of its own
  // and notarizes with the Apple ID.
  return { env: clean, config: { bundle: { macOS: { signingIdentity: clean.APPLE_SIGNING_IDENTITY.trim() } } }, missing: [] };
}
