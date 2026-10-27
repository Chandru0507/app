$body = @"
{"name":"Test User","email":"test@example.com","password":"password123"}
"@
$result = Invoke-RestMethod -Method Post -Uri 'http://localhost:5000/api/auth/register' -Body $body -ContentType 'application/json'
Write-Output "Status: $($result.status)"
Write-Output "Response: $($result)"