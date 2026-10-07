export type User={id:string;username:string;displayName:string;bio:string;color:string;createdAt:string};
export type Session={token:string;expiresAt:string;user:User};
export type Channel={id:string;name:string;description:string;kind:'public'|'private';ownerId:string|null;memberCount:number;unread:number;lastReadId:string;createdAt:string;lastMessage:{body:string;author:string;createdAt:string}|null};
export type DiscoverChannel={id:string;name:string;description:string;kind:string;memberCount:number;joined:boolean};
export type Message={id:string;channelId:string;clientId:string;body:string;createdAt:string;editedAt:string|null;deletedAt:string|null;author:Pick<User,'id'|'username'|'displayName'|'color'>;reply:{id:string;body:string;author:string}|null;pending?:boolean;failed?:boolean};
export type Page={messages:Message[];hasMore:boolean};
