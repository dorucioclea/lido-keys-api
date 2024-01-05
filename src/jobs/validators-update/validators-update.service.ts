import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER, LoggerService } from 'common/logger';
import { PrometheusService } from 'common/prometheus';
import { ConfigService } from 'common/config';
import { JobService } from 'common/job';
import { ValidatorsService } from 'validators';
import { OneAtTime } from 'common/decorators/oneAtTime';
import { SchedulerRegistry } from '@nestjs/schedule';
import { isMainThread, parentPort, workerData } from 'worker_threads';

export interface ValidatorsFilter {
  pubkeys: string[];
  statuses: string[];
  max_amount: number | undefined;
  percent: number | undefined;
}

class ValidatorsOutdatedError extends Error {
  lastBlock: number;

  constructor(message, lastBlock) {
    super(message);
    this.lastBlock = lastBlock;
  }
}

@Injectable()
export class ValidatorsUpdateService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly prometheusService: PrometheusService,
    protected readonly configService: ConfigService,
    protected readonly jobService: JobService,
    protected readonly validatorsService: ValidatorsService,
    protected readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  // prometheus metrics
  protected lastBlockTimestampSec: number | undefined = undefined;
  protected lastBlockNumber: number | undefined = undefined;
  protected lastSlot: number | undefined = undefined;

  // name of interval for updating validators
  public UPDATE_VALIDATORS_JOB_NAME = 'ValidatorsUpdate';
  // timeout for update validators
  // if during 60 minutes nothing happen we will exit
  UPDATE_VALIDATORS_TIMEOUT_MS = 90 * 60 * 1000;
  updateDeadlineTimer: undefined | NodeJS.Timeout = undefined;

  public isDisabledRegistry() {
    return !this.configService.get('VALIDATOR_REGISTRY_ENABLE');
  }

  public async onModuleInit(): Promise<void> {
    this.logger.log('module init validators!!!');
    // Do not wait for initialization to avoid blocking the main process
    this.initialize().catch((err) => this.logger.error(err));
  }

  public async onModuleDestroy() {
    this.logger.log('Jobs Service on module destroy');
    try {
      const intervalUpdateValidators = this.schedulerRegistry.getInterval(this.UPDATE_VALIDATORS_JOB_NAME);
      clearInterval(intervalUpdateValidators);
    } catch {}
  }

  public async initialize() {
    // at first start timer for checking update
    // if timer isn't cleared in 90 minutes period, we will consider it as nodejs frizzing and exit
    this.checkValidatorsUpdateTimeout();
    await this.updateValidators().catch((error) => this.logger.error(error));

    const interval_ms = this.configService.get('UPDATE_VALIDATORS_INTERVAL_MS');
    const interval = setInterval(() => this.updateValidators().catch((error) => this.logger.error(error)), interval_ms);
    this.schedulerRegistry.addInterval(this.UPDATE_VALIDATORS_JOB_NAME, interval);

    this.logger.log('Finished ValidatorsUpdateService initialization');
  }

  private checkValidatorsUpdateTimeout() {
    const currTimestampSec = new Date().getTime() / 1000;
    // currTimestampSec - this.lastBlockTimestampSec - time since last update in seconds
    // this.UPDATE_KEYS_TIMEOUT_MS / 1000 - timeout in seconds
    // so if time since last update is less than timeout, this means keys are updated
    // TODO: maybe in past the problem was in blocked event loop and instead of this we need to add unblocking function
    const isUpdated =
      this.lastBlockTimestampSec &&
      currTimestampSec - this.lastBlockTimestampSec < this.UPDATE_VALIDATORS_TIMEOUT_MS / 1000;

    if (this.updateDeadlineTimer && isUpdated) clearTimeout(this.updateDeadlineTimer);

    this.updateDeadlineTimer = setTimeout(async () => {
      const error = new ValidatorsOutdatedError(
        `There were no validators update more than ${this.UPDATE_VALIDATORS_TIMEOUT_MS / (60 * 1000)} minutes`,
        this.lastBlockNumber,
      );
      this.logger.error(error);
      process.exit(1);
    }, this.UPDATE_VALIDATORS_TIMEOUT_MS);
  }

  @OneAtTime()
  private async updateValidators() {
    if (isMainThread) {
      this.logger.log('validators in main thread!!!! ohhh my goood');
    }

    if (workerData !== undefined || parentPort !== undefined) {
      console.log(workerData);
      console.log(parentPort);
      console.log(isMainThread);
      this.logger.log('validators is in a worker thread, that is a good job!!!!! ');
    }

    await this.jobService.wrapJob({ name: 'Update validators from ValidatorsRegistry' }, async () => {
      const meta = await this.validatorsService.updateValidators('finalized');
      // meta shouldn't be null
      // if update didn't happen, meta will be fetched from db
      this.lastBlockTimestampSec = meta?.timestamp ?? this.lastBlockTimestampSec;
      this.lastBlockNumber = meta?.blockNumber ?? this.lastBlockNumber;
      this.lastSlot = meta?.slot ?? this.lastSlot;

      // TODO: send to main process
      this.updateMetrics();

      // Call this to check if validators have been updated within the expected time frame
      // and to always set a new timer after a successful update.
      this.checkValidatorsUpdateTimeout();
    });
  }

  private updateMetrics() {
    parentPort?.postMessage({
      lastBlockTimestampSec: this.lastBlockTimestampSec,
      lastBlockNumber: this.lastBlockNumber,
      lastSlot: this.lastSlot,
    });
    // if (this.lastBlockTimestampSec) {
    //   this.prometheusService.validatorsRegistryLastTimestampUpdate.set(this.lastBlockTimestampSec);
    // }

    // if (this.lastBlockNumber) {
    //   this.prometheusService.validatorsRegistryLastBlockNumber.set(this.lastBlockNumber);
    // }
    // if (this.lastSlot) {
    //   this.prometheusService.validatorsRegistryLastSlot.set(this.lastSlot);
    // }

    this.logger.log('ValidatorsRegistry metrics updated');
  }
}
