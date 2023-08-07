/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { nullTransport, LoggerModule } from '@lido-nestjs/logger';
import { getNetwork } from '@ethersproject/networks';
import { JsonRpcBatchProvider } from '@ethersproject/providers';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { key } from '../fixtures/key.fixture';
import { RegistryKeyStorageService, KeyRegistryModule, KeyRegistryService, RegistryStorageService } from '../../';
import { MikroORM } from '@mikro-orm/core';
import { REGISTRY_CONTRACT_ADDRESSES } from '@lido-nestjs/contracts';

describe('Key', () => {
  const CHAIN_ID = process.env.CHAIN_ID || 1;
  const address = REGISTRY_CONTRACT_ADDRESSES[CHAIN_ID];
  const provider = new JsonRpcBatchProvider(process.env.PROVIDERS_URLS);
  let validatorService: KeyRegistryService;
  let keyStorage: RegistryKeyStorageService;
  let storageService: RegistryStorageService;

  const mockCall = jest.spyOn(provider, 'call').mockImplementation(async () => '');

  jest.spyOn(provider, 'detectNetwork').mockImplementation(async () => getNetwork('mainnet'));

  beforeEach(async () => {
    const imports = [
      MikroOrmModule.forRoot({
        dbName: ':memory:',
        type: 'sqlite',
        allowGlobalContext: true,
        entities: ['./**/*.entity.ts'],
      }),
      LoggerModule.forRoot({ transports: [nullTransport()] }),
      KeyRegistryModule.forFeature({ provider }),
    ];
    const moduleRef = await Test.createTestingModule({ imports }).compile();
    validatorService = moduleRef.get(KeyRegistryService);
    keyStorage = moduleRef.get(RegistryKeyStorageService);
    storageService = moduleRef.get(RegistryStorageService);

    const generator = moduleRef.get(MikroORM).getSchemaGenerator();
    await generator.updateSchema();
  });

  afterEach(async () => {
    mockCall.mockReset();
    await storageService.onModuleDestroy();
  });

  test('getToIndex', async () => {
    const expected = 10;

    expect(validatorService.getToIndex({ totalSigningKeys: expected } as any)).toBe(expected);
  });

  test('getAllKeysFromStorage', async () => {
    const expected = [{ index: 0, operatorIndex: 0, moduleAddress: address, ...key, used: false }];
    jest.spyOn(keyStorage, 'findAll').mockImplementation(async () => expected);

    await expect(validatorService.getAllKeysFromStorage(address)).resolves.toBe(expected);
  });

  test('getUsedKeysFromStorage', async () => {
    const expected = [{ index: 0, operatorIndex: 0, moduleAddress: address, ...key, used: true }];
    jest.spyOn(keyStorage, 'findUsed').mockImplementation(async () => expected);

    await expect(validatorService.getUsedKeysFromStorage(address)).resolves.toBe(expected);
  });
});
