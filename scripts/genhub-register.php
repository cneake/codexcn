<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/wp-load.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$username = isset($input['username']) ? sanitize_user($input['username']) : '';
$email = isset($input['email']) ? sanitize_email($input['email']) : '';
$password = isset($input['password']) ? $input['password'] : '';

// 验证
if (empty($username) || empty($email) || empty($password)) {
    echo json_encode(['error' => '用户名、邮箱、密码不能为空']);
    exit;
}

if (strlen($username) < 3) {
    echo json_encode(['error' => '用户名至少3个字符']);
    exit;
}

if (!is_email($email)) {
    echo json_encode(['error' => '邮箱格式不正确']);
    exit;
}

if (strlen($password) < 6) {
    echo json_encode(['error' => '密码至少6个字符']);
    exit;
}

// 检查用户名是否存在
if (username_exists($username)) {
    echo json_encode(['error' => '用户名已存在']);
    exit;
}

// 检查邮箱是否存在
if (email_exists($email)) {
    echo json_encode(['error' => '邮箱已被注册']);
    exit;
}

// 创建用户
$user_id = wp_create_user($username, $password, $email);
if (is_wp_error($user_id)) {
    echo json_encode(['error' => $user_id->get_error_message()]);
    exit;
}

// 设置用户显示名
wp_update_user([
    'ID' => $user_id,
    'display_name' => $username,
    'role' => 'subscriber', // 默认普通用户
]);

echo json_encode([
    'success' => true,
    'user_id' => $user_id,
    'username' => $username,
    'message' => '注册成功，请登录'
]);
