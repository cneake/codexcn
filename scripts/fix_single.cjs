<?php
/**
 * 修复 single.php：有封面图时不再删除正文图片
 * 因为封面图通常是 logo/装饰图，不一定是正文首图
 * 正文章节配图一律保留
 */

$file = '/www/wwwroot/agent.eake.cn/wp-content/themes/ylan-agent/single.php';
$content = file_get_contents($file);

// 原逻辑：有特色图时，移除内容中所有<img>标签
$old = "  if (has_post_thumbnail()) {
    // 有特色图时，移除内容中所有<img>标签，避免重复
    \$post_content = preg_replace('/<img[^>]*>/i', '', \$post_content);
  } else {
    // 无特色图时，只保留第一张图片，移除其余
    \$count = 0;
    \$post_content = preg_replace_callback('/<img[^>]*>/i', function(\$m) use (&\$count) {
      \$count++;
      return \$count === 1 ? \$m[0] : '';
    }, \$post_content);
  }";

// 新逻辑：所有正文图片一律保留，正文有封面图副本也不重复显示由 CSS 处理
// 移除对 <img> 的删除逻辑，原样输出
$new = "  // 保留所有正文图片（封面图与正文配图通常不同，无需删除）
  // 历史逻辑：有特色图时删除所有正文图（避免重复），但用户反映正文配图被误删，已禁用
  \$count = 0;
  \$post_content = preg_replace_callback('/<img[^>]*>/i', function(\$m) use (&\$count) {
    \$count++;
    return \$m[0];
  }, \$post_content);";

if (strpos($content, $old) === false) {
    echo "OLD pattern not found, dumping context...\n";
    // 尝试模糊匹配
    if (strpos($content, "preg_replace('/<img[^>]*>/i'") !== false) {
        echo "OK, img preg_replace is there\n";
    }
    exit(1);
}

$content = str_replace($old, $new, $content);
file_put_contents($file, $content);
echo "OK: single.php fixed, all content images preserved\n";