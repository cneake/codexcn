const {Client} = require('D:/codexhubcn/cc-switch-clone/node_modules/ssh2');
const c = new Client();
c.on('ready', () => {
  const py = `python3 << 'PYEOF'
import pymysql
conn = pymysql.connect(host='localhost', user='agent_wp', password='AiAgent2026!', database='agent_wp', charset='utf8mb4')
cur = conn.cursor()

# 1. 找文章 2985 的封面图附件 ID
cur.execute("SELECT meta_value FROM wp_postmeta WHERE post_id=2985 AND meta_key='_thumbnail_id'")
row = cur.fetchone()
if row:
    thumb_id = int(row[0])
    print(f'Thumbnail attachment ID: {thumb_id}')

    # 2. 拿附件文件名
    cur.execute("SELECT meta_value FROM wp_postmeta WHERE post_id=%s AND meta_key='_wp_attached_file'", (thumb_id,))
    file_row = cur.fetchone()
    if file_row:
        file_path = '/www/wwwroot/agent.eake.cn/wp-content/uploads/' + file_row[0]
        print(f'Thumbnail file: {file_path}')

    # 3. 删除 _thumbnail_id 元数据
    cur.execute("DELETE FROM wp_postmeta WHERE post_id=2985 AND meta_key='_thumbnail_id'")
    print(f'Deleted _thumbnail_id meta, affected {cur.rowcount} rows')

    # 4. 删除封面图附件（可选 - 用户没说删附件，只删关联）
    # 这里暂不删附件文件，用户说"删除封面"= 解除关联
else:
    print('No _thumbnail_id found for post 2985')

conn.commit()
conn.close()
print('DONE')
PYEOF`;

  c.exec(py, (err, stream) => {
    let out = '';
    stream.on('data', d => out += d);
    stream.on('end', () => { console.log(out); c.end(); });
  });
}).connect({host:'103.52.153.201', port:22, username:'root', password:'Ea61091793'});