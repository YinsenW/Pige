param(
  [Parameter(Mandatory = $true)][string]$Directory,
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$ExpectedThumbprint,
  [switch]$RequireUnpackedExecutable
)

$ErrorActionPreference = "Stop"
if ($Tag -notmatch '^v(?<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-alpha(?:\.(?:0|[1-9]\d*|[A-Za-z][0-9A-Za-z-]*))*)$') {
  throw "Invalid release tag."
}
$version = $Matches.version
$expected = ($ExpectedThumbprint -replace '\s', '').ToUpperInvariant()
if ($expected -notmatch '^[0-9A-F]{40}$') { throw "Expected Windows signing thumbprint is absent or invalid." }
$setup = Join-Path $Directory "Pige-$version-x64-setup.exe"
$targets = @($setup)
if ($RequireUnpackedExecutable) { $targets += (Join-Path $Directory "win-unpacked\Pige.exe") }

foreach ($target in $targets) {
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Signed Windows release artifact is absent." }
  $signature = Get-AuthenticodeSignature -LiteralPath $target
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Windows Authenticode signature is not valid."
  }
  if ($null -eq $signature.SignerCertificate) { throw "Windows signer certificate is absent." }
  $actual = ($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
  if ($actual -ne $expected) { throw "Windows artifact signer thumbprint does not match the trusted release identity." }
}

$report = [ordered]@{
  schemaVersion = 1
  platform = "windows-x64"
  authenticodeValid = $true
  signerThumbprint = $expected
  verifiedTargets = $targets.Count
}
$report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Directory "windows-signature-report.json") -Encoding utf8NoBOM
Write-Host "Signed Windows release artifacts verified."
