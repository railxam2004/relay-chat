import {chromium,expect} from '@playwright/test';
import {createApplication} from '../apps/server/src/app.js';
import {mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';

const server=await createApplication({port:0,dbDriver:'pglite',pgliteDir:':memory:',redisUrl:null,elasticUrl:null,messageRateLimit:10000});
const base=await server.listen(0);
server.config.origins.push(base);
let browser;
const errors=[];
try{
  let options={headless:true,args:['--no-sandbox']};
  if(process.env.PLAYWRIGHT_EXECUTABLE_PATH)options.executablePath=process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  else if(!existsSync(chromium.executablePath())&&process.platform==='linux'){
    const {default:portable}=await import('@sparticuz/chromium');
    options={...options,args:portable.args,executablePath:await portable.executablePath()};
  }
  browser=await chromium.launch(options);
  const a=await browser.newContext({viewport:{width:1440,height:960}}),b=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const alice=await a.newPage(),bob=await b.newPage();
  for(const page of [alice,bob])page.on('pageerror',error=>errors.push(error.message));
  async function register(page,username,name){
    await page.goto(base);await page.getByRole('button',{name:'Регистрация',exact:true}).click();
    await page.getByRole('textbox',{name:'Ваше имя',exact:true}).fill(name);await page.locator('input[autocomplete="username"]').fill(username);await page.locator('input[autocomplete="new-password"]').fill('TestPassword123');
    await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Сообщения',exact:true})).toBeVisible();
    await page.getByTestId('channel-00000000-0000-4000-8000-000000000001').click();
    await expect(page.getByRole('textbox',{name:'Сообщение',exact:true})).toBeEnabled();
  }
  await register(alice,'alice_e2e','Алиса');await register(bob,'bob_e2e','Боб');
  await expect(alice.getByText('Подключено',{exact:true})).toBeVisible();
  async function send(page,body){
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const composer=page.getByRole('textbox',{name:'Сообщение',exact:true});
    await composer.fill(body);await expect(composer).toHaveValue(body);
    await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();
    await expect(composer).toHaveValue('');
  }
  await send(alice,'Всем привет! Проверяю наш чат.');
  await expect(bob.getByTestId('message').filter({hasText:'Всем привет! Проверяю наш чат.'})).toHaveCount(1);
  await send(bob,'Привет! С телефона всё работает.');
  await expect(alice.getByTestId('message').filter({hasText:'Привет! С телефона всё работает.'})).toHaveCount(1);
  console.log('PASS: два клиента и мобильная отправка');
  await alice.getByTestId('message').filter({hasText:'Всем привет!'}).hover();
  await alice.getByTestId('message').filter({hasText:'Всем привет!'}).getByRole('button',{name:/Действия с сообщением/}).click();
  await alice.getByRole('button',{name:'Изменить',exact:true}).click();
  await alice.getByRole('textbox',{name:'Сообщение',exact:true}).fill('Всем привет! Проверка связи завершена.');await alice.getByRole('button',{name:'Сохранить сообщение',exact:true}).click();
  await expect(bob.getByTestId('message').filter({hasText:'Проверка связи завершена'})).toHaveCount(1);
  console.log('PASS: редактирование видно на втором клиенте');
  const incoming=bob.getByTestId('message').filter({hasText:'Проверка связи завершена'});
  await incoming.getByRole('button',{name:/Действия с сообщением/}).click();await bob.getByRole('button',{name:'Ответить',exact:true}).click();
  await send(bob,'Да, сообщение вижу.');
  await expect(alice.getByTestId('message').filter({hasText:'Да, сообщение вижу.'}).getByRole('button',{name:/Алиса/})).toBeVisible();
  console.log('PASS: ответ на сообщение');
  await alice.getByRole('button',{name:'Поиск сообщений',exact:true}).click();await alice.getByRole('textbox',{name:'Текст для поиска'}).fill('Проверка связи');await alice.getByRole('button',{name:'Найти',exact:true}).click();await expect(alice.locator('.search-result')).toHaveCount(1);await alice.getByRole('button',{name:'Закрыть',exact:true}).click();
  await alice.getByRole('button',{name:'Создать канал',exact:true}).click();await alice.getByLabel('Название',{exact:true}).fill('Проект · чат');await alice.getByLabel('Описание',{exact:true}).fill('Обсуждаем работу и делимся идеями.');await alice.getByRole('dialog').getByRole('button',{name:'Создать канал',exact:true}).click();await expect(alice.getByRole('heading',{name:'Проект · чат',exact:true})).toBeVisible();
  await bob.getByRole('button',{name:'К списку каналов'}).click();await bob.getByRole('button',{name:'Найти канал',exact:true}).click();await bob.getByRole('button').filter({hasText:'Проект · чат'}).click();await expect(bob.getByRole('heading',{name:'Проект · чат',exact:true})).toBeVisible();
  await send(alice,'Вынесем обсуждение проекта в отдельный канал.');await expect(bob.getByTestId('message').filter({hasText:'Вынесем обсуждение'})).toHaveCount(1);
  console.log('PASS: создание, обнаружение и вступление в канал');
  const sessionA=await alice.evaluate(()=>JSON.parse(localStorage.getItem('relay.session.v1')));
  const sessionB=await bob.evaluate(()=>JSON.parse(localStorage.getItem('relay.session.v1')));
  const channelId=await alice.evaluate(userId=>localStorage.getItem(`relay.channel.${userId}`),sessionA.user.id);
  const sameId='11111111-1111-4111-8111-111111111111';
  for(const [account,body] of [[sessionA,'Идентификатор: автор А'],[sessionB,'Идентификатор: автор Б']]){
    const response=await fetch(`${base}/api/channels/${channelId}/messages`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${account.token}`},body:JSON.stringify({body,clientId:sameId})});expect(response.status).toBe(201);
  }
  await expect(alice.getByTestId('message').filter({hasText:'Идентификатор:'})).toHaveCount(2);
  console.log('PASS: clientId разных авторов не скрывает чужое сообщение');
  await b.setOffline(true);await send(alice,'Сообщение во время отключения');await b.setOffline(false);await expect(bob.getByTestId('message').filter({hasText:'Сообщение во время отключения'})).toHaveCount(1,{timeout:15000});
  console.log('PASS: восстановление истории после отключения');
  await send(bob,'<img src=x onerror=alert(1)>');await expect(alice.getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();await expect(alice.locator('.message-body img')).toHaveCount(0);
  console.log('PASS: HTML сообщения отображается текстом');
  const unsafe=bob.getByTestId('message').filter({hasText:'<img src=x onerror=alert(1)>'});
  await unsafe.getByRole('button',{name:/Действия с сообщением/}).click();await bob.getByRole('button',{name:'Удалить',exact:true}).click();await bob.getByRole('dialog').getByRole('button',{name:'Удалить',exact:true}).click();
  await expect(alice.getByTestId('message').filter({hasText:'Сообщение удалено'})).toHaveCount(1);
  await send(bob,'Проверили отправку с разных устройств.');
  console.log('PASS: удаление видно на втором клиенте');
  await bob.reload();await expect(bob.getByTestId('channel-00000000-0000-4000-8000-000000000001')).toBeVisible();await bob.getByRole('button').filter({hasText:'Проект · чат'}).click();await expect(bob.getByTestId('message').filter({hasText:'Сообщение во время отключения'})).toHaveCount(1);
  const width=await bob.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));expect(width.document).toBeLessThanOrEqual(width.viewport);
  console.log('PASS: сессия после reload и мобильная ширина');
  await alice.getByRole('button',{name:'Мои каналы',exact:true}).click();await alice.getByTestId('channel-00000000-0000-4000-8000-000000000001').click();await bob.getByRole('button',{name:'К списку каналов'}).click();await bob.getByTestId('channel-00000000-0000-4000-8000-000000000001').click();
  await send(alice,'Здесь можно создавать каналы, отвечать и искать сообщения.');await send(bob,'Отлично, продолжаем!');await expect(alice.getByTestId('message').filter({hasText:'Отлично, продолжаем'})).toHaveCount(1);
  await expect(alice.getByTestId('channel-00000000-0000-4000-8000-000000000001').locator('.unread-badge')).toHaveCount(0);
  await expect(alice.locator('.channel-heading')).toContainText('2 участника');
  await mkdir('test-results',{recursive:true});await alice.screenshot({path:'test-results/web-desktop.png'});await bob.screenshot({path:'test-results/web-mobile.png'});
  expect(errors).toEqual([]);
  console.log('PASS: ошибок JavaScript нет. Screenshots: test-results/');
}catch(error){
  await mkdir('test-results',{recursive:true});
  let index=0;
  for(const context of browser?.contexts()||[])for(const page of context.pages())await page.screenshot({path:`test-results/failure-${index++}.png`}).catch(()=>{});
  throw error;
}finally{await browser?.close();await server.close();}
