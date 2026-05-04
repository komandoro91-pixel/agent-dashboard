'use strict';

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    pipeline: () => ({
      rpush: jest.fn(),
      ltrim: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    }),
  })),
}));

const handler = require('../../api/collect');

function makeReq({ method = 'POST', headers = {}, body = {} } = {}) {
  return { method, headers, body };
}

function makeRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  delete process.env.COLLECT_TOKEN;
});

describe('collect auth — fail-closed', () => {
  it('case 1: empty env + no token header → 401', async () => {
    process.env.COLLECT_TOKEN = '';
    const req = makeReq({ headers: {}, body: { phase: 'start' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('case 2: empty env + token header "wrong" → 401', async () => {
    process.env.COLLECT_TOKEN = '';
    const req = makeReq({ headers: { 'x-token': 'wrong' }, body: { phase: 'start' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('case 3: env=secret + header=secret → 200', async () => {
    process.env.COLLECT_TOKEN = 'secret';
    const req = makeReq({ headers: { 'x-token': 'secret' }, body: { phase: 'start' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('case 4: env=secret + header=wrong → 401', async () => {
    process.env.COLLECT_TOKEN = 'secret';
    const req = makeReq({ headers: { 'x-token': 'wrong' }, body: { phase: 'start' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('case 5: env not set (deleted) + token header → 401', async () => {
    // beforeEach already deletes the var; do not re-assign.
    expect(process.env.COLLECT_TOKEN).toBeUndefined();
    const req = makeReq({ headers: { 'x-token': 'anything' }, body: { phase: 'start' } });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
