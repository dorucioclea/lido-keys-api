import { Inject, Injectable, LoggerService, NotFoundException } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { KeyListResponse, KeyWithModuleAddress } from './entities';
import { ConfigService } from 'common/config';
import { ELBlockSnapshot, KeyQuery } from 'http/common/entities';
import { CuratedModuleService, StakingRouterModule, STAKING_MODULE_TYPE } from 'staking-router-modules/';
import { httpExceptionTooEarlyResp } from 'http/common/entities/http-exceptions/too-early-resp';
import { StakingRouterService } from 'staking-router-modules/staking-router.service';

@Injectable()
export class KeysService {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected curatedService: CuratedModuleService,
    protected configService: ConfigService,
    protected stakingRouterService: StakingRouterService,
  ) {}

  async get(filters: KeyQuery): Promise<any> {
    const stakingModules = this.stakingRouterService.getStakingModules();

    if (stakingModules.length === 0) {
      this.logger.warn("No staking modules in list. Maybe didn't fetched from SR yet");
      throw httpExceptionTooEarlyResp();
    }

    // keys could be of type CuratedKey | CommunityKey
    // const collectedKeys: KeyWithModuleAddress[][] = [];
    let elBlockSnapshot: ELBlockSnapshot | null = null;

    const { keysStream, meta } = await this.curatedService.getKeysWithMetaStream({
      used: filters.used,
      operatorIndex: filters.operatorIndex,
    });

    // TODO: how will work fetching data from multiple modules

    if (!meta) {
      this.logger.warn("Meta is null, maybe data hasn't been written in db yet.");
      throw httpExceptionTooEarlyResp();
    }

    elBlockSnapshot = new ELBlockSnapshot(meta);

    if (!elBlockSnapshot) {
      this.logger.warn("Meta for response wasn't set.");
      throw httpExceptionTooEarlyResp();
    }

    return {
      keysStream,
      meta: {
        elBlockSnapshot,
      },
    };
  }

  async getByPubkey(pubkey: string): Promise<KeyListResponse> {
    const stakingModules = this.stakingRouterService.getStakingModules();

    if (stakingModules.length == 0) {
      this.logger.warn('No staking modules in list. Maybe didnt fetched from SR yet');
      throw httpExceptionTooEarlyResp();
    }

    // keys could be of type CuratedKey | CommunityKey
    const collectedKeys: KeyWithModuleAddress[][] = [];
    let elBlockSnapshot: ELBlockSnapshot | null = null;

    for (let i = 0; i < stakingModules.length; i++) {
      if (stakingModules[i].type == STAKING_MODULE_TYPE.CURATED_ONCHAIN_V1_TYPE) {
        // If some of modules has null meta, it means update hasnt been finished
        const { keys: curatedKeys, meta } = await this.curatedService.getKeyWithMetaByPubkey(pubkey);
        if (!meta) {
          this.logger.warn("Meta is null, maybe data hasn't been written in db yet.");
          throw httpExceptionTooEarlyResp();
        }

        const keysWithAddress: KeyWithModuleAddress[] = curatedKeys.map(
          (key) => new KeyWithModuleAddress(key, stakingModules[i].stakingModuleAddress),
        );

        // meta should be the same for all modules
        // so in answer we can use meta of any module
        // lets use meta of first module in list
        // currently we sure if stakingModules is not empty, we will have in list Curated Module
        // in future this check should be in each if clause
        if (i == 0) {
          elBlockSnapshot = new ELBlockSnapshot(meta);
        }

        collectedKeys.push(keysWithAddress);
      }
    }

    // we check stakingModules list types so this condition should never be true
    if (!elBlockSnapshot) {
      this.logger.warn("Meta for response wasn't set.");
      throw httpExceptionTooEarlyResp();
    }

    const keys = collectedKeys.flat();
    if (keys.length == 0) {
      throw new NotFoundException(`There are no keys with ${pubkey} public key in db.`);
    }

    return {
      data: keys,
      meta: {
        elBlockSnapshot,
      },
    };
  }

  async getByPubkeys(pubkeys: string[]): Promise<KeyListResponse> {
    const stakingModules = this.stakingRouterService.getStakingModules();

    if (stakingModules.length == 0) {
      this.logger.warn("No staking modules in list. Maybe didn't fetched from SR yet");
      throw httpExceptionTooEarlyResp();
    }

    // keys could be of type CuratedKey | CommunityKey
    const collectedKeys: KeyWithModuleAddress[][] = [];
    let elBlockSnapshot: ELBlockSnapshot | null = null;

    for (let i = 0; i < stakingModules.length; i++) {
      if (stakingModules[i].type == STAKING_MODULE_TYPE.CURATED_ONCHAIN_V1_TYPE) {
        // If some of modules has null meta, it means update hasnt been finished
        const { keys: curatedKeys, meta } = await this.curatedService.getKeysWithMetaByPubkeys(pubkeys);
        if (!meta) {
          this.logger.warn("Meta is null, maybe data hasn't been written in db yet.");
          throw httpExceptionTooEarlyResp();
        }

        const keysWithAddress: KeyWithModuleAddress[] = curatedKeys.map(
          (key) => new KeyWithModuleAddress(key, stakingModules[i].stakingModuleAddress),
        );

        // meta should be the same for all modules
        // so in answer we can use meta of any module
        // lets use meta of first module in list
        // currently we sure if stakingModules is not empty, we will have in list Curated Module
        // in future this check should be in each if clause
        if (i == 0) {
          elBlockSnapshot = new ELBlockSnapshot(meta);
        }

        collectedKeys.push(keysWithAddress);
      }
    }

    // we check stakingModules list types so this condition should never be true
    if (!elBlockSnapshot) {
      this.logger.warn("Meta for response wasn't set.");
      throw httpExceptionTooEarlyResp();
    }

    return {
      data: collectedKeys.flat(),
      meta: {
        elBlockSnapshot,
      },
    };
  }
}
