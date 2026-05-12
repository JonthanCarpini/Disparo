<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Verificar se ?? POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'M??todo n??o permitido']);
    exit();
}

// Obter dados do POST
$input = file_get_contents('php://input');
$data = json_decode($input, true);

// Se json_decode falhar, tentar decodificar novamente (caso N8N envie JSON como string)
if (!$data || (count($data) === 1 && empty(current($data)))) {
    // Pegar a primeira chave (que pode ser o JSON como string)
    $possibleJson = key($data);
    if ($possibleJson) {
        $decoded = json_decode($possibleJson, true);
        if ($decoded) {
            $data = $decoded;
            error_log('QPanel Proxy - JSON estava como string, decodificado novamente');
        }
    }
}

if (!$data) {
    echo json_encode([
        'success' => false, 
        'message' => 'Dados inv??lidos',
        'debug' => [
            'raw_input' => substr($input, 0, 500),
            'decoded_data' => $data
        ]
    ]);
    exit();
}

// Log de debug
error_log('QPanel Proxy - Dados recebidos: ' . json_encode($data));

// URLs dos workers dispon??veis (ordenados por prioridade)
$workers = [
    'https://p2.carpini2023.workers.dev',  // Worker que funciona
    'https://qpanel-login-worker.codeium-ai.workers.dev/',
    'https://qpanel-automation.workers.dev/'
];

// Usar URL customizada se fornecida
$workerUrl = $data['worker_url'] ?? $workers[0];

// Processar a????o - IMPORTANTE: salvar antes de remover
$action = $data['action'] ?? '';

// Log da a????o detectada
error_log('QPanel Proxy - A????o detectada: ' . $action);

// Validar se action foi fornecida
if (empty($action)) {
    echo json_encode([
        'success' => false, 
        'message' => 'A????o n??o especificada. Use: login, search, renew, create, get_client, get_servers',
        'debug' => [
            'data_received' => $data,
            'action_value' => $action
        ]
    ]);
    exit();
}

// Remover worker_url e action dos dados para n??o enviar duplicado
unset($data['worker_url']);
unset($data['action']);

// Processar diferentes a????es
if ($action === 'login') {
    $targetUrl = $workerUrl . '?' . http_build_query([
        'url' => 'https://painel.p2player.top/api/auth/login',
        'method' => 'POST',
        'cookies' => ''
    ]);
    
    $postData = json_encode([
        'username' => $data['username'],
        'password' => $data['password'],
        'action' => 'search_clients'
    ]);
    
} elseif ($action === 'search' || $action === 'search_clients') {
    $apiUrl = 'https://painel.p2player.top/api/auth/login';
    $params = [
        'page' => $data['page'] ?? 1,
        'perPage' => $data['per_page'] ?? 100,
        'userId' => $data['user_id'] ?? ''
    ];
    
    // Adicionar filtros conforme a estrutura correta
    if (!empty($data['search_term'])) $params['username'] = $data['search_term'];
    if (!empty($data['status'])) $params['status'] = $data['status'];
    if (!empty($data['server'])) $params['serverId'] = $data['server'];
    if (!empty($data['package'])) $params['packageId'] = $data['package'];
    if (!empty($data['trial'])) $params['isTrial'] = $data['trial']; // YES ou NO
    
    // Filtros de data diretos
    if (!empty($data['expiry_from'])) $params['expiryFrom'] = $data['expiry_from'];
    if (!empty($data['expiry_to'])) $params['expiryTo'] = $data['expiry_to'];
    
    // Filtros de expira????o predefinidos
    if (!empty($data['expiry'])) {
        switch($data['expiry']) {
            case 'today':
                $params['expiryFrom'] = date('Y-m-d');
                $params['expiryTo'] = date('Y-m-d');
                break;
            case 'week':
                $params['expiryFrom'] = date('Y-m-d');
                $params['expiryTo'] = date('Y-m-d', strtotime('+7 days'));
                break;
            case 'month':
                $params['expiryFrom'] = date('Y-m-d');
                $params['expiryTo'] = date('Y-m-d', strtotime('+30 days'));
                break;
            case 'expired':
                $params['expiryTo'] = date('Y-m-d', strtotime('-1 day'));
                break;
        }
    }
    
    // Ordena????o ser?? feita no lado do cliente (API n??o suporta)
    
    // Adicionar par??metros vazios conforme a URL de exemplo
    if (!isset($params['serverId'])) $params['serverId'] = '';
    if (!isset($params['packageId'])) $params['packageId'] = '';
    if (!isset($params['expiryFrom'])) $params['expiryFrom'] = '';
    if (!isset($params['expiryTo'])) $params['expiryTo'] = '';
    if (!isset($params['status'])) $params['status'] = '';
    if (!isset($params['isTrial'])) $params['isTrial'] = '';
    if (!isset($params['connections'])) $params['connections'] = '';
    
    $targetUrl = $workerUrl . '?' . http_build_query([
        'url' => $apiUrl . '?' . http_build_query($params),
        'cookies' => ''
    ]);
    
    // Debug: log da URL constru??da
    error_log('QPanel Proxy - URL de pesquisa: ' . $targetUrl);
    
    $postData = null; // GET request
    
} elseif ($action === 'renew' || $action === 'renew_client') {
    // A????o de renova????o de cliente
    $clientId = $data['client_id'] ?? '';
    
    if (empty($clientId)) {
        echo json_encode(['success' => false, 'message' => 'ID do cliente ?? obrigat??rio']);
        exit();
    }
    
    $apiUrl = "https://painel.p2player.top/api/customers/{$clientId}/renew";
    
    $targetUrl = $workerUrl . '?' . http_build_query([
        'url' => $apiUrl,
        'method' => 'POST',
        'cookies' => ''
    ]);
    
    // Dados para renova????o
    $renewData = [
        'package_id' => $data['package_id'] ?? null,
        'connections' => (int)($data['connections'] ?? 1)
    ];
    
    $postData = json_encode($renewData);
    
    // Debug: log da renova????o
    error_log('QPanel Proxy - Renova????o: ' . $targetUrl . ' - Dados: ' . $postData);
    
} elseif ($action === 'create' || $action === 'create_client') {
    // A????o de cria????o de cliente
    $username = $data['username'] ?? '';
    $password = $data['password'] ?? '';
    $packageId = $data['package_id'] ?? '';
    
    if (empty($username) || empty($password) || empty($packageId)) {
        echo json_encode(['success' => false, 'message' => 'Username, password e package_id s??o obrigat??rios']);
        exit();
    }
    
    $apiUrl = "https://painel.p2player.top/api/customers";
    
    $targetUrl = $workerUrl . '?' . http_build_query([
        'url' => $apiUrl,
        'method' => 'POST',
        'cookies' => ''
    ]);
    
    // Dados para cria????o
    $createData = [
        'server_id' => $data['server_id'] ?? '',
        'package_id' => $packageId,
        'username' => $username,
        'password' => $password,
        'connections' => (int)($data['connections'] ?? 1),
        'bouquets' => $data['bouquets'] ?? '',
        'parent_can_edit_personal_data' => $data['parent_can_edit_personal_data'] ?? 'YES'
    ];
    
    // Adicionar campos extras se fornecidos
    if (isset($data['name']) && !empty($data['name'])) {
        $createData['name'] = $data['name'];
    }
    
    if (isset($data['email']) && !empty($data['email'])) {
        $createData['email'] = $data['email'];
    }
    
    if (isset($data['whatsapp']) && !empty($data['whatsapp'])) {
        $createData['whatsapp'] = $data['whatsapp'];
    }
    
    if (isset($data['note']) && !empty($data['note'])) {
        $createData['note'] = $data['note'];
    }
    
    // Adicionar trial_hours se fornecido
    if (isset($data['trial_hours']) && !empty($data['trial_hours'])) {
        $createData['trial_hours'] = (int)$data['trial_hours'];
    }
    
    if (isset($data['mac_address']) && !empty($data['mac_address'])) {
        $createData['mac_address'] = $data['mac_address'];
    }
    
    // Debug: log dos dados de cria????o
    error_log('QPanel Proxy - Dados de cria????o: ' . json_encode($createData));
    
    $postData = json_encode($createData);
    
} elseif ($action === 'get_client') {
    // A????o para buscar dados completos de um cliente
    $clientId = $data['client_id'] ?? '';
    
    if (empty($clientId)) {
        echo json_encode(['success' => false, 'message' => 'ID do cliente ?? obrigat??rio']);
        exit();
    }
    
    $apiUrl = "https://painel.p2player.top/api/customers/{$clientId}";
    
    $targetUrl = $workerUrl . '?' . http_build_query([
        'url' => $apiUrl,
        'cookies' => ''
    ]);
    
    // Debug: log da busca do cliente
    error_log('QPanel Proxy - Buscando cliente: ' . $targetUrl);
    
    $postData = null; // GET request
    
} elseif ($action === 'custom_request') {
    // A????o para requisi????es personalizadas
    $customUrl = $data['url'] ?? '';
    
    if (empty($customUrl)) {
        echo json_encode(['success' => false, 'message' => 'URL personalizada ?? obrigat??ria']);
        exit();
    }
    
    $targetUrl = $workerUrl . '?' . http_build_query([
        'url' => $customUrl,
        'cookies' => ''
    ]);
    
    // Debug: log da requisi????o personalizada
    error_log('QPanel Proxy - Requisi????o personalizada: ' . $targetUrl);
    
    $postData = null; // GET request
    
} elseif ($action === 'get_servers') {
    // A????o para buscar servidores e pacotes
    $apiUrl = "https://painel.p2player.top/api/servers";
    
    $targetUrl = $workerUrl . '?' . http_build_query([
        'url' => $apiUrl,
        'cookies' => ''
    ]);
    
    // Debug: log da busca de servidores
    error_log('QPanel Proxy - Buscando servidores: ' . $targetUrl);
    
    $postData = null; // GET request
    
} else {
    // A????o gen??rica
    $targetUrl = $workerUrl;
    $postData = json_encode($data);
}

// Fun????o para fazer requisi????o cURL
function makeRequest($url, $postData = null, $customHeaders = []) {
    $ch = curl_init();
    
    $headers = [
        'Accept: application/json',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    ];
    
    // Adicionar headers customizados
    foreach ($customHeaders as $header) {
        $headers[] = $header;
    }
    
    $options = [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3
    ];
    
    if ($postData !== null) {
        $options[CURLOPT_POST] = true;
        $options[CURLOPT_POSTFIELDS] = $postData;
        $options[CURLOPT_HTTPHEADER][] = 'Content-Type: application/json';
    }
    
    curl_setopt_array($ch, $options);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    
    curl_close($ch);
    
    return [
        'response' => $response,
        'http_code' => $httpCode,
        'error' => $error
    ];
}

// Preparar headers customizados
$customHeaders = [];
$actionsWithAuth = ['create', 'renew', 'get_client', 'get_servers', 'custom_request', 'search', 'search_clients'];
if (in_array($action, $actionsWithAuth) && !empty($data['token'])) {
    $customHeaders[] = 'Authorization: Bearer ' . $data['token'];
    $customHeaders[] = 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
}

// Tentar com a URL principal primeiro
$result = makeRequest($targetUrl, $postData, $customHeaders);

// Se falhar, tentar com outras URLs (apenas para login)
if (($result['error'] || $result['http_code'] !== 200) && $action === 'login') {
    foreach ($workers as $fallbackUrl) {
        if ($fallbackUrl === $workerUrl) continue; // Pular a que j?? tentamos
        
        $fallbackTargetUrl = $fallbackUrl . '?' . http_build_query([
            'url' => 'https://painel.p2player.top/api/auth/login',
            'method' => 'POST',
            'cookies' => ''
        ]);
        
        $result = makeRequest($fallbackTargetUrl, $postData);
        
        if (!$result['error'] && $result['http_code'] === 200) {
            $workerUrl = $fallbackUrl; // Atualizar URL que funcionou
            break;
        }
    }
}

// Verificar se houve erro na requisi????o
if ($result['error']) {
    echo json_encode([
        'success' => false,
        'message' => 'Erro de conex??o: ' . $result['error'],
        'debug' => [
            'worker_url' => $workerUrl,
            'curl_error' => $result['error']
        ]
    ]);
    exit();
}

// Verificar c??digo HTTP (aceitar 200 e 201)
if ($result['http_code'] !== 200 && $result['http_code'] !== 201) {
    // Tratamento especial para 401 (token inv??lido/expirado)
    if ($result['http_code'] === 401) {
        echo json_encode([
            'success' => false,
            'message' => 'Token inv??lido ou expirado (HTTP 401)',
            'debug' => [
                'worker_url' => $workerUrl,
                'http_code' => $result['http_code'],
                'action' => $action,
                'token_provided' => !empty($data['token']),
                'token_preview' => !empty($data['token']) ? substr($data['token'], 0, 20) . '...' : 'N/A',
                'response' => substr($result['response'], 0, 300)
            ]
        ]);
        exit();
    }
    
    echo json_encode([
        'success' => false,
        'message' => 'Erro HTTP: ' . $result['http_code'],
        'debug' => [
            'worker_url' => $workerUrl,
            'http_code' => $result['http_code'],
            'action' => $action,
            'response' => substr($result['response'], 0, 500)
        ]
    ]);
    exit();
}

// Se HTTP 201, ?? sucesso na cria????o
if ($result['http_code'] === 201) {
    $responseData = json_decode($result['response'], true);
    if ($responseData) {
        echo json_encode([
            'success' => true,
            'message' => 'Conta criada com sucesso (HTTP 201)',
            'data' => $responseData,
            'debug' => [
                'worker_url' => $workerUrl,
                'http_code' => $result['http_code']
            ]
        ]);
        exit();
    }
}

// Decodificar resposta
$responseData = json_decode($result['response'], true);

if (!$responseData) {
    echo json_encode([
        'success' => false,
        'message' => 'Resposta inv??lida do worker',
        'debug' => [
            'worker_url' => $workerUrl,
            'raw_response' => substr($result['response'], 0, 500)
        ]
    ]);
    exit();
}

// Processar resposta baseada na a????o
if ($action === 'login') {
    // Para login, verificar se tem id e token
    if (isset($responseData['id']) && isset($responseData['token'])) {
        $responseData['success'] = true;
        $responseData['user_data'] = [
            'id' => $responseData['id'],
            'username' => $responseData['username'] ?? '',
            'credits' => $responseData['credits'] ?? 0
        ];
    } else {
        $responseData['success'] = false;
        $responseData['message'] = 'Credenciais inv??lidas';
    }
} elseif ($action === 'search_clients') {
    // Para pesquisa, verificar se tem dados
    if (isset($responseData['data']) && is_array($responseData['data'])) {
        $responseData['success'] = true;
        $responseData['clients'] = $responseData['data'];
        $responseData['total_results'] = $responseData['total'] ?? 0;
        $responseData['total_pages'] = $responseData['last_page'] ?? 1;
    } else {
        $responseData['success'] = false;
        $responseData['message'] = 'Erro na pesquisa ou token inv??lido';
    }
}

// Adicionar informa????es extras na resposta
$responseData['worker_used'] = $workerUrl;
$responseData['timestamp'] = date('Y-m-d H:i:s');

// Retornar resposta
echo json_encode($responseData);
?>


