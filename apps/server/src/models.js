export const messageColumns = `m.id::text,m.channel_id,m.client_id,m.body,m.reply_to_id::text,m.created_at,m.edited_at,m.deleted_at,
u.id AS author_id,u.username,u.display_name,u.color,
r.body AS reply_body,r.deleted_at AS reply_deleted,ru.display_name AS reply_author`;
export const messageJoins = `JOIN users u ON u.id=m.author_id
LEFT JOIN messages r ON r.id=m.reply_to_id LEFT JOIN users ru ON ru.id=r.author_id`;
export function publicMessage(r) {
  return { id: r.id, channelId: r.channel_id, clientId: r.client_id,
    body: r.deleted_at ? '' : r.body, createdAt: r.created_at, editedAt: r.edited_at, deletedAt: r.deleted_at,
    author: { id: r.author_id, username: r.username, displayName: r.display_name, color: r.color },
    reply: r.reply_to_id ? { id: r.reply_to_id, body: r.reply_deleted ? 'Сообщение удалено' : r.reply_body, author: r.reply_author } : null };
}
export async function getMessage(db, id) {
  const { rows } = await db.query(`SELECT ${messageColumns} FROM messages m ${messageJoins} WHERE m.id=$1`, [id]);
  return rows[0] ? publicMessage(rows[0]) : null;
}
export async function isMember(db, channelId, userId) {
  return (await db.query('SELECT 1 FROM memberships WHERE channel_id=$1 AND user_id=$2', [channelId,userId])).rows.length > 0;
}
export async function listChannels(db, userId) {
  const { rows } = await db.query(`SELECT c.*,ms.last_read_id::text,
    (SELECT count(*)::int FROM memberships WHERE channel_id=c.id) AS member_count,
    (SELECT count(*)::int FROM messages WHERE channel_id=c.id AND id>ms.last_read_id AND author_id<>$1 AND deleted_at IS NULL) AS unread,
    lm.body AS last_body,lm.deleted_at AS last_deleted,lm.created_at AS last_at,lu.display_name AS last_author
    FROM channels c JOIN memberships ms ON ms.channel_id=c.id AND ms.user_id=$1
    LEFT JOIN LATERAL (SELECT * FROM messages WHERE channel_id=c.id ORDER BY id DESC LIMIT 1) lm ON true
    LEFT JOIN users lu ON lu.id=lm.author_id ORDER BY COALESCE(lm.created_at,c.created_at) DESC,c.id`, [userId]);
  return rows.map(r => ({ id:r.id,name:r.name,description:r.description,kind:r.kind,ownerId:r.owner_id,
    memberCount:r.member_count,unread:r.unread,lastReadId:r.last_read_id,
    lastMessage:r.last_at ? { body:r.last_deleted ? 'Сообщение удалено' : r.last_body,author:r.last_author,createdAt:r.last_at } : null,
    createdAt:r.created_at }));
}
