import { expect, test, vi } from 'vitest'
import Max from './../index.js'

test('test process.env.MAX_ENV is nah', () => {
  expect(process.env.MAX_ENV).toBe("nah")
})

test('test MAX_ENV enum', () => {
  expect(Max.MAX_ENV.MAX).toBe("max");
  expect(Max.MAX_ENV.MAX_FOR_LIVE).toBe("maxforlive");
  expect(Max.MAX_ENV.STANDALONE).toBe("max:standalone");
})

test('test MESSAGE_TYPES enum', () => {
  expect(Max.MESSAGE_TYPES.ALL).toBe("all");
  expect(Max.MESSAGE_TYPES.BANG).toBe("bang");
  expect(Max.MESSAGE_TYPES.DICT).toBe("dict");
  expect(Max.MESSAGE_TYPES.NUMBER).toBe("number");
  expect(Max.MESSAGE_TYPES.LIST).toBe("list");
})

test('test POST_LEVELS enum', () => {
  expect(Max.POST_LEVELS.ERROR).toBe("error");
  expect(Max.POST_LEVELS.INFO).toBe("info");
  expect(Max.POST_LEVELS.WARN).toBe("warn");
})

test('test addHandler', () => {
  expect(Max.addHandler(Max.MESSAGE_TYPES.BANG,(...args)=>{})).toBe();
})


test('test outlet', async () =>  {
  expect.assertions(1)
  await expect(Max.outlet()).resolves.toBe();
})

test('test post', async () =>  {
  expect.assertions(3)
  const consoleMock = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  await expect(Max.post("testing")).resolves.toBe();
  expect(consoleMock).toHaveBeenCalledOnce();
  expect(consoleMock).toHaveBeenLastCalledWith('testing');
})

test('test getDict', async () =>  {
  expect.assertions(1)
  await expect(Max.getDict()).resolves.toMatchObject({});
})

test('test setDict', async () =>  {
  expect.assertions(1)
  await expect(Max.setDict("test", {})).resolves.toMatchObject({});
})

test('test updateDict', async () =>  {
  expect.assertions(1)
  await expect(Max.updateDict("test", "stuff.things", {})).resolves.toMatchObject({});
})