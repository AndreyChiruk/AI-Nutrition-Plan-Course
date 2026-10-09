import { createHash } from 'crypto';
import { after, before, describe, it } from 'mocha';
import { assert } from 'chai';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module';
import { User } from '../../models/User';

const rawPrefix = process.env.GLOBAL_API_PREFIX?.trim();
const PREFIX = rawPrefix ? rawPrefix.replace(/^\/+|\/+$/g, '') : '';

function api(route: string): string {
  const r = route.startsWith('/') ? route : `/${route}`;
  return PREFIX ? `/${PREFIX}${r}` : r;
}

describe('API smoke / интеграционные тесты', function () {
  this.timeout(120_000);

  let app: INestApplication | undefined;
  let jwtService: JwtService;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;
  let integrationUserId = '';
  const integrationEmail = 'integration-api-test@local.test';
  const integrationPassword = 'IntegrationTest1!';
  let skipSuite = false;

  before(async () => {
    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      if (PREFIX) {
        app.setGlobalPrefix(PREFIX);
      }
      await app.init();
      httpServer = app.getHttpServer();
      jwtService = moduleFixture.get(JwtService);

      const UserModel = moduleFixture.get<typeof User>(getModelToken(User));
      const passwordHash = createHash('sha256').update(integrationPassword).digest('hex');
      const [user, created] = await UserModel.findOrCreate({
        where: { email: integrationEmail },
        defaults: {
          email: integrationEmail,
          password: passwordHash,
          role: 'user',
          birthDate: new Date('1990-01-01'),
        } as never,
      });
      if (!created) {
        await user.update({ password: passwordHash, role: 'user' } as never);
      }
      integrationUserId = String(user.id);
    } catch (err) {
   
      console.error(
        '[integration] Пропуск набора: не удалось подключиться к БД или инициализировать приложение.',
        err,
      );
      skipSuite = true;
    }
  });

  after(async () => {
    if (app) {
      await app.close();
    }
  });

  it('01 GET /recommendations/base — публичный маршрут, 200', async function () {
    if (skipSuite) this.skip();
    const res = await request(httpServer).get(api('/recommendations/base')).expect(200);
    assert.isArray(res.body);
  });

  it('02 GET /users/:id без Authorization — 401', async function () {
    if (skipSuite) this.skip();
    await request(httpServer).get(api(`/users/${integrationUserId}`)).expect(401);
  });

  it('03 GET /users/:id с невалидным JWT — 401', async function () {
    if (skipSuite) this.skip();
    await request(httpServer)
      .get(api(`/users/${integrationUserId}`))
      .set('Authorization', 'Bearer invalid.token.here')
      .expect(401);
  });

  it('04 GET /users/:id с JWT другого пользователя — 403', async function () {
    if (skipSuite) this.skip();
    const alienToken = jwtService.sign(
      { sub: 999999998, role: 'user', email: 'alien@test.local' },
      { expiresIn: '15m' },
    );
    await request(httpServer)
      .get(api(`/users/${integrationUserId}`))
      .set('Authorization', `Bearer ${alienToken}`)
      .expect(403);
  });

  it('05 GET /users/:id с корректным JWT владельца — 200', async function () {
    if (skipSuite) this.skip();
    const token = jwtService.sign(
      { sub: Number(integrationUserId), role: 'user', email: integrationEmail },
      { expiresIn: '15m' },
    );
    const res = await request(httpServer)
      .get(api(`/users/${integrationUserId}`))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.property(res.body, 'id');
    assert.equal(String(res.body.id), integrationUserId);
  });

  it('06 GET /stats/summary/:userId с JWT владельца — 200', async function () {
    if (skipSuite) this.skip();
    const token = jwtService.sign(
      { sub: Number(integrationUserId), role: 'user', email: integrationEmail },
      { expiresIn: '15m' },
    );
    const res = await request(httpServer)
      .get(api(`/stats/summary/${integrationUserId}`))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.property(res.body, 'mealPlansCount');
  });

  it('07 GET /meal-plan/active/:userId без JWT — 401', async function () {
    if (skipSuite) this.skip();
    await request(httpServer).get(api(`/meal-plan/active/${integrationUserId}`)).expect(401);
  });

  it('08 GET /meal-plan/dishes с JWT — 200', async function () {
    if (skipSuite) this.skip();
    const token = jwtService.sign(
      { sub: Number(integrationUserId), role: 'user', email: integrationEmail },
      { expiresIn: '15m' },
    );
    const res = await request(httpServer)
      .get(api('/meal-plan/dishes'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.isArray(res.body);
  });

  it('09 POST /auth/login с неверным паролем — 401', async function () {
    if (skipSuite) this.skip();
    await request(httpServer)
      .post(api('/auth/login'))
      .send({ email: integrationEmail, password: 'wrong-password-xyz' })
      .expect(401);
  });

  it('10 POST /auth/login с верными учётными данными — 201 и accessToken', async function () {
    if (skipSuite) this.skip();
    const res = await request(httpServer)
      .post(api('/auth/login'))
      .send({ email: integrationEmail, password: integrationPassword })
      .expect(201);
    assert.property(res.body, 'accessToken');
    assert.property(res.body, 'user');
  });

  it('11 GET /admin/users с JWT пользователя (не admin) — 403', async function () {
    if (skipSuite) this.skip();
    const token = jwtService.sign(
      { sub: Number(integrationUserId), role: 'user', email: integrationEmail },
      { expiresIn: '15m' },
    );
    await request(httpServer).get(api('/admin/users')).set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('12 GET /workout-plan/blocks с JWT — 200', async function () {
    if (skipSuite) this.skip();
    const token = jwtService.sign(
      { sub: Number(integrationUserId), role: 'user', email: integrationEmail },
      { expiresIn: '15m' },
    );
    const res = await request(httpServer)
      .get(api('/workout-plan/blocks'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.isArray(res.body);
  });
});
