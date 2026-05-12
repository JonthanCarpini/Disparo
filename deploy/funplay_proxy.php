<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Método não permitido']);
    exit();
}

$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data) {
    echo json_encode(['success' => false, 'message' => 'Dados inválidos ou corpo vazio']);
    exit();
}

// Montar o payload conforme a requisição que você capturou
$payload = [
    'mac' => $data['mac'] ?? '',
    'code' => $data['code'] ?? '',
    'username' => $data['username'] ?? '',
    'password' => $data['password'] ?? '',
    'is_protected' => isset($data['is_protected']) ? (bool)$data['is_protected'] : false,
    'type' => $data['type'] ?? 'admin_server'
];

$ch = curl_init('https://api.funplays.app/api/playlist/code');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));

// Headers idênticos ao do navegador para evitar bloqueio do Cloudflare
$headers = [
    'Accept: application/json, text/plain, */*',
    'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Authorization: Bearer null',
    'Content-Type: application/json',
    'Origin: https://funplays.app',
    'Referer: https://funplays.app/',
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'sec-ch-ua: "Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile: ?0',
    'sec-ch-ua-platform: "Windows"',
    'sec-fetch-dest: empty',
    'sec-fetch-mode: cors',
    'sec-fetch-site: same-site'
];

curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
curl_setopt($ch, CURLOPT_ENCODING, 'gzip, deflate, br'); // Importante para lidar com a compressão do Cloudflare

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
curl_close($ch);

if ($error) {
    echo json_encode(['success' => false, 'message' => 'Erro cURL: ' . $error]);
    exit();
}

// Tentar decodificar a resposta da API do Fun Play
$decodedResponse = json_decode($response, true);

echo json_encode([
    'success' => ($httpCode >= 200 && $httpCode < 300),
    'http_code' => $httpCode,
    'response' => $decodedResponse !== null ? $decodedResponse : $response
]);