import {
  MultipartContext,
  PutFileOptions,
  uploadMultipart,
} from './me-upload';

/**
 * Тесты на `uploadMultipart` — orchestrator multipart-загрузки. PUT в S3
 * мокаем через `opts.put`, остальные методы (start/partURL/complete/abort)
 * — через `MultipartContext` jasmine-spy.
 */

function makeFile(sizeBytes: number, name = 't.mp4', type = 'video/mp4'): File {
  // ArrayBuffer заполненный нулями — достаточно для file.slice() тестов.
  const data = new Uint8Array(sizeBytes);
  return new File([data], name, { type });
}

function makeCtx(
  overrides: Partial<MultipartContext> = {},
  partSize = 5 * 1024 * 1024,
): jasmine.SpyObj<MultipartContext> {
  const ctx = jasmine.createSpyObj<MultipartContext>('MultipartContext', [
    'start',
    'partURL',
    'complete',
    'abort',
  ]);
  ctx.start.and.returnValue(
    Promise.resolve({
      uploadID: 'upl-1',
      key: 'portfolio/user/x.mp4',
      publicURL: 'https://stub/x.mp4',
      partSize,
    }),
  );
  ctx.partURL.and.callFake(({ partNumber }) =>
    Promise.resolve(`https://stub/part?n=${partNumber}`),
  );
  ctx.complete.and.returnValue(Promise.resolve());
  ctx.abort.and.returnValue(Promise.resolve());
  Object.assign(ctx, overrides);
  return ctx;
}

/** Стабовый PUT возвращает фейк-ETag. */
function makePut(etag = '"fake-etag"', delayMs = 0): jasmine.Spy {
  return jasmine.createSpy('put').and.callFake(
    (_url: string, _blob: Blob, _opts: PutFileOptions) =>
      delayMs > 0
        ? new Promise<string>((resolve) => setTimeout(() => resolve(etag), delayMs))
        : Promise.resolve(etag),
  );
}

describe('uploadMultipart', () => {
  it('happy path: режет файл, льёт каждую часть, complete', async () => {
    const partSize = 5 * 1024 * 1024;
    const file = makeFile(partSize * 2 + 100, 't.mp4'); // 3 части (2 полных + хвост)
    const ctx = makeCtx({}, partSize);
    const put = makePut('"e"');

    const url = await uploadMultipart(file, ctx, { put });

    expect(url).toBe('https://stub/x.mp4');
    expect(ctx.start).toHaveBeenCalledTimes(1);
    expect(ctx.partURL).toHaveBeenCalledTimes(3);
    expect(put).toHaveBeenCalledTimes(3);
    expect(ctx.complete).toHaveBeenCalledTimes(1);
    expect(ctx.abort).not.toHaveBeenCalled();
    // Parts должны быть переданы упорядоченными по part_number.
    const completeArgs = ctx.complete.calls.mostRecent().args[0];
    expect(completeArgs.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
  });

  it('последняя часть может быть меньше partSize (не падает)', async () => {
    const partSize = 5 * 1024 * 1024;
    const file = makeFile(partSize + 17); // 2 части: 5MB + 17B
    const ctx = makeCtx({}, partSize);
    const put = makePut();

    await uploadMultipart(file, ctx, { put });
    expect(ctx.partURL).toHaveBeenCalledTimes(2);
  });

  it('etag_missing → throw + вызов ctx.abort (cleanup)', async () => {
    const file = makeFile(1024); // 1 часть
    const ctx = makeCtx({}, 5 * 1024 * 1024);
    const put = makePut(''); // empty ETag — CORS не пропустил

    await expectAsync(uploadMultipart(file, ctx, { put })).toBeRejectedWithError(
      /etag_missing/i,
    );
    expect(ctx.abort).toHaveBeenCalledTimes(1);
    expect(ctx.complete).not.toHaveBeenCalled();
  });

  it('ошибка PUT любой части → abort + throw', async () => {
    const partSize = 5 * 1024 * 1024;
    const file = makeFile(partSize * 2);
    const ctx = makeCtx({}, partSize);
    let call = 0;
    const put = jasmine.createSpy('put').and.callFake(() => {
      call++;
      if (call === 2) return Promise.reject(new Error('upload_500'));
      return Promise.resolve('"e"');
    });

    await expectAsync(uploadMultipart(file, ctx, { put, concurrency: 1 })).toBeRejectedWithError(
      'upload_500',
    );
    expect(ctx.abort).toHaveBeenCalledTimes(1);
    expect(ctx.complete).not.toHaveBeenCalled();
  });

  it('abort signal до начала → ни одной части не льётся + abort вызывается', async () => {
    const file = makeFile(10 * 1024 * 1024);
    const ctx = makeCtx();
    const put = makePut();
    const controller = new AbortController();
    controller.abort();

    await expectAsync(
      uploadMultipart(file, ctx, { put, signal: controller.signal }),
    ).toBeRejectedWithError('upload_aborted');
    // Должен попытаться прибрать orphan-части.
    expect(ctx.abort).toHaveBeenCalled();
  });

  it('progress: после каждой части сумма дотягивается до total', async () => {
    const partSize = 4;
    const file = makeFile(10); // 3 части: 4 + 4 + 2
    const ctx = makeCtx({}, partSize);
    const put = makePut();
    const progressEvents: number[] = [];

    await uploadMultipart(file, ctx, {
      put,
      onProgress: (p) => progressEvents.push(p.percent),
      concurrency: 1,
    });
    // Последнее событие должно быть 100.
    expect(progressEvents[progressEvents.length - 1]).toBe(100);
  });

  it('concurrency=3: все 3 части запускаются параллельно', async () => {
    const partSize = 5 * 1024 * 1024;
    const file = makeFile(partSize * 3);
    const ctx = makeCtx({}, partSize);
    let inFlight = 0;
    let peakInFlight = 0;
    const put = jasmine.createSpy('put').and.callFake(async () => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return '"e"';
    });

    await uploadMultipart(file, ctx, { put, concurrency: 3 });
    expect(peakInFlight).toBe(3);
  });

  it('concurrency=1: части идут строго последовательно (peak=1)', async () => {
    const partSize = 5 * 1024 * 1024;
    const file = makeFile(partSize * 3);
    const ctx = makeCtx({}, partSize);
    let inFlight = 0;
    let peakInFlight = 0;
    const put = jasmine.createSpy('put').and.callFake(async () => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return '"e"';
    });

    await uploadMultipart(file, ctx, { put, concurrency: 1 });
    expect(peakInFlight).toBe(1);
  });

  it('абортируем во время загрузки → ctx.abort вызван, complete нет', async () => {
    const partSize = 5 * 1024 * 1024;
    const file = makeFile(partSize * 3);
    const ctx = makeCtx({}, partSize);
    const controller = new AbortController();
    // PUT держит обещание долго — успеваем aborts'нуть до завершения.
    const put = jasmine.createSpy('put').and.callFake(
      (_url: string, _blob: Blob, opts: PutFileOptions) =>
        new Promise<string>((_, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('upload_aborted')));
        }),
    );

    const promise = uploadMultipart(file, ctx, {
      put,
      signal: controller.signal,
      concurrency: 1,
    });
    // Чуть подождать чтобы worker зашёл в первую часть.
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();

    await expectAsync(promise).toBeRejected();
    expect(ctx.complete).not.toHaveBeenCalled();
    expect(ctx.abort).toHaveBeenCalled();
  });
});
