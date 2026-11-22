# Permissions lifecycle only, never executes model-provided commands.
param([ValidateSet('snapshot','configure','cleanup','inspect','repair','verify')][string]$Operation,
 [Parameter(Mandatory)][string]$Workspace,[Parameter(Mandatory)][string]$Journal,
 [string]$OfficialScript,[switch]$WaitForLease)
$ErrorActionPreference='Stop'
if($WaitForLease){if([Console]::ReadLine() -ne 'LEASE_READY'){throw 'Process lease not established'}}
$app=Split-Path $PSScriptRoot -Parent
$base=[IO.Path]::GetFullPath((Join-Path $app 'workspaces\executions'))
$root=[IO.Path]::GetFullPath($Workspace)
if((Split-Path $root -Parent) -ne $base -or (Split-Path $root -Leaf) -notmatch '^rrpg-dsh-[0-9a-f-]{36}$'){throw 'Not a managed workspace'}
$journalPath=[IO.Path]::GetFullPath($Journal)
if(!$journalPath.StartsWith((Join-Path $app 'runtime')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Journal outside runtime'}
for($p=$root;$p -and $p.Length -ge $app.Length;$p=Split-Path $p -Parent){if((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse point refused'}}
if($Operation -eq 'repair'){
 & $OfficialScript -Path $root -AllowRoot $root -Out (Join-Path $Journal 'official')
 exit $LASTEXITCODE
}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class ManagedWorkspaceLabels {
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern uint GetNamedSecurityInfoW(string p,int t,uint i,out IntPtr o,out IntPtr g,out IntPtr d,out IntPtr s,out IntPtr sd);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern uint SetNamedSecurityInfoW(string p,int t,uint i,IntPtr o,IntPtr g,IntPtr d,IntPtr s);
 [DllImport("advapi32.dll")] static extern bool GetAce(IntPtr a,uint n,out IntPtr e);
 [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
 public static object[] Read(string p){IntPtr o,g,d,s,sd;uint code=GetNamedSecurityInfoW(p,1,16,out o,out g,out d,out s,out sd);if(code!=0)throw new Exception("Read labels Win32 "+code);try{var r=new List<object>();if(s!=IntPtr.Zero){int count=(ushort)Marshal.ReadInt16(s,4);for(uint i=0;i<count;i++){IntPtr ace;if(!GetAce(s,i,out ace))throw new Exception("GetAce failed");if(Marshal.ReadByte(ace)==17)r.Add(new {sid=new SecurityIdentifier(IntPtr.Add(ace,8)).Value,mask=Marshal.ReadInt32(ace,4)});}}return r.ToArray();}finally{LocalFree(sd);}}
 public static void Clear(string p){var code=SetNamedSecurityInfoW(p,1,16,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);if(code!=0)throw new Exception("Clear label Win32 "+code);}
}
'@
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$access=[Security.AccessControl.AccessControlSections]::Access
function Save($file,$value){$tmp=$file+'.tmp';$value|ConvertTo-Json -Depth 15|Set-Content -LiteralPath $tmp -Encoding utf8;Move-Item -LiteralPath $tmp -Destination $file -Force}
function Observe($p){
 $full=[IO.Path]::GetFullPath($p)
 if($full -ne $root -and !$full.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Object outside managed lease'}
 for($ancestor=$full;$ancestor.Length -ge $root.Length;$ancestor=Split-Path $ancestor -Parent){if((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse ancestor refused'}}
 $i=Get-Item -LiteralPath $p -Force
 if($i.Attributes -band [IO.FileAttributes]::ReparsePoint){throw "Reparse point refused: $p"}
 $a=Get-Acl -LiteralPath $p
 if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value){throw "Unexpected owner: $p"}
 [ordered]@{path=$p;directory=$i.PSIsContainer;owner=$sid.Value;dacl=$a.GetSecurityDescriptorSddlForm($access);labels=@([ManagedWorkspaceLabels]::Read($p));sha256=if($i.PSIsContainer){$null}else{(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash}}
}
function RestoreDacl($r){
 $a=if($r.directory){[Security.AccessControl.DirectorySecurity]::new()}else{[Security.AccessControl.FileSecurity]::new()}
 $a.SetSecurityDescriptorSddlForm($r.dacl,$access);Set-Acl -LiteralPath $r.path -AclObject $a
 $actual=Get-Acl -LiteralPath $r.path
 if($r.dacl -eq 'D:AI'){
  if($actual.AreAccessRulesProtected -or @($actual.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier])).Count){throw 'Fresh directory own DACL restore verification failed'}
 }elseif($actual.GetSecurityDescriptorSddlForm($access) -ne $r.dacl){throw 'DACL restore verification failed'}
}
$baselineFile=Join-Path $Journal 'baseline.json'
if($Operation -eq 'snapshot'){
 if(Test-Path -LiteralPath $baselineFile){throw 'Baseline exists; never overwrite'}
 if(@(Get-ChildItem -LiteralPath $root -Force).Count){throw 'Only newly created empty workspaces may be provisioned'}
 $r=Observe $root
 if($r.labels.Count){throw 'Unexpected initial integrity label'}
 Save $baselineFile $r
 Write-Output 'BASELINE_SAVED';exit 0
}
if($Operation -eq 'inspect'){Observe $root|ConvertTo-Json -Depth 10;exit 0}
$baseline=Get-Content -LiteralPath $baselineFile -Raw|ConvertFrom-Json
if($baseline.path -ne $root -or $baseline.owner -ne $sid.Value -or $baseline.labels.Count){throw 'Baseline mismatch'}
if($Operation -eq 'verify'){
 $current=Observe $root
 if($current.labels.Count -or $current.dacl -ne $baseline.dacl -or $current.owner -ne $baseline.owner){throw 'Root security drift'}
 $recordsDir=Join-Path $Journal 'objects'
 $count=1
 foreach($file in Get-ChildItem -LiteralPath $recordsDir -Filter '*.json'){
  $r=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json;$actual=Observe $r.path
  if($actual.labels.Count -or $actual.dacl -ne $r.dacl -or $actual.owner -ne $r.owner -or $actual.sha256 -ne $r.sha256){throw "Object security or content drift: $($r.path)"};$count++
 }
 Write-Output ('READ_ONLY_VERIFIED objects='+$count);exit 0
}
if($Operation -eq 'configure'){
 # Only this brand new lease tree: metadata rights needed by native private-temp
 # materialization. Never FullControl inheritance or changes to the parent.
 $a=Get-Acl -LiteralPath $root
 $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::TakeOwnership,[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
 Set-Acl -LiteralPath $root -AclObject $a
 foreach($name in @('work','temp')){New-Item -ItemType Directory -Path (Join-Path $root $name)|Out-Null}
 Write-Output 'MANAGED_LAYOUT_READY';exit 0
}
# A killed cleanup can leave a temporary ACE: restore durable pending entries first.
$recordsDir=Join-Path $Journal 'objects';[IO.Directory]::CreateDirectory($recordsDir)|Out-Null
foreach($file in Get-ChildItem -LiteralPath $recordsDir -Filter '*.json'){
 $r=Get-Content -LiteralPath $file.FullName -Raw|ConvertFrom-Json
 if(!$r.path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Recovery object outside workspace'}
 Observe $r.path|Out-Null
 RestoreDacl $r
}
Observe $root|Out-Null
RestoreDacl $baseline
# These directories did not exist before this lease. Their initial own DACL was
# empty; remove native standing/restrictive ACE residue without touching old data.
$nativeDirs=@((Join-Path $root 'work'))
$tempRoot=Join-Path $root 'temp'
if(Test-Path -LiteralPath $tempRoot){$nativeDirs+=@(Get-ChildItem -LiteralPath $tempRoot -Directory -Force | Where-Object {$_.Name -match '^dsh-[A-Za-z0-9]+$'} | ForEach-Object {$_.FullName})}
foreach($p in $nativeDirs){if(Test-Path -LiteralPath $p){Observe $p|Out-Null;RestoreDacl @{path=$p;directory=$true;dacl='D:AI'}}}
# Enumerate explicitly without following junctions. Abort, do not skip unsafe objects.
$paths=[Collections.Generic.List[string]]::new();$paths.Add($root)
for($index=0;$index -lt $paths.Count;$index++){
 $p=$paths[$index];$r=Observe $p
 if($r.directory){foreach($i in Get-ChildItem -LiteralPath $p -Force){if($i.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse child refused'};$paths.Add($i.FullName)}}
 if($paths.Count -gt 10000){throw 'Recovery tree exceeds bounded inspection; manual review required'}
}
$results=[Collections.Generic.List[object]]::new()
foreach($p in $paths){
 $r=Observe $p
 if($r.labels.Count -gt 1 -or ($r.labels.Count -eq 1 -and ($r.labels[0].sid -ne 'S-1-16-4096' -or $r.labels[0].mask -ne 1))){throw 'Unexpected integrity label; no silent overwrite'}
 if($p -eq $root){$original=$baseline}else{
  $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($p)))
  $file=Join-Path $recordsDir ($key+'.json')
  if(!(Test-Path -LiteralPath $file)){Save $file $r}
  $original=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json
 }
 if($r.labels.Count){
  try{
   $a=Get-Acl -LiteralPath $p
   $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::TakeOwnership,[Security.AccessControl.AccessControlType]::Allow))
   Set-Acl -LiteralPath $p -AclObject $a
   [ManagedWorkspaceLabels]::Clear($p)
  }finally{RestoreDacl $original}
 }
 $after=Observe $p
 if($after.labels.Count -or $after.dacl -ne $original.dacl -or $after.owner -ne $original.owner -or $after.sha256 -ne $original.sha256){throw "Recovery verification failed: $p"}
 $results.Add([ordered]@{path=$p;labelCleared=$true;daclRestored=$true;ownerUnchanged=$true;fileUnchanged=$true})
 Save (Join-Path $Journal 'cleanup-results.json') @($results.ToArray())
}
Write-Output ('CLEANUP_VERIFIED objects='+$results.Count)
