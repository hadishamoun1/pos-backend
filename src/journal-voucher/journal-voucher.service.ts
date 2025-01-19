import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { JournalVoucher } from '../entities/Vouchers/journalVoucher.entity';
import { JournalVoucherDetail } from '../entities/Vouchers/journalVoucherDetails.entity';
import { Account } from '../entities/account.entity';
import { CurrencyRate } from '../entities/currencyRate.entity';

@Injectable()
export class JournalVoucherService {
  constructor(
    @InjectRepository(JournalVoucher)
    private readonly journalVoucherRepository: Repository<JournalVoucher>,
    @InjectRepository(JournalVoucherDetail)
    private readonly journalVoucherDetailRepository: Repository<JournalVoucherDetail>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(CurrencyRate)
    private readonly currencyRateRepository: Repository<CurrencyRate>,
  ) {}

  async createJournalVoucher(data: {
    date: Date;
    jvType: string;
    details: {
      accountNumber: string;
      check?: string | null;
      checkDate?: Date | null;
      bankName?: string | null;
      description?: string | null;
      debit: string;
      debitUSD: string;
      debitLL: string;
      credit: string;
      creditUSD: string;
      creditLL: string;
      currency: string;
      exchangeRateEURtoUSD: string;
      exchangeRate: string;
      docNbr?: string | null;
    }[];
  }): Promise<JournalVoucher> {
    const { date, jvType, details } = data;

    // Step 1: Validate `jvType`
    if (!jvType || !['S', 'G'].includes(jvType)) {
      throw new BadRequestException('Invalid JV type. Must be "S" or "G".');
    }

    // Step 2: Validate `details`
    if (!details || details.length === 0) {
      throw new BadRequestException('Voucher must have at least one detail.');
    }

    // Step 3: Generate `jvNumber` based on `jvType`
    const prefix = jvType === 'S' ? 'JV' : 'JVG';
    const lastVoucher = await this.journalVoucherRepository.find({
      where: { jvNumber: Like(`${prefix} - %`) },
      order: { jvNumber: 'DESC' },
      take: 1,
    });

    const nextNumber =
      lastVoucher.length > 0
        ? parseInt(lastVoucher[0].jvNumber.split(' - ')[1], 10) + 1
        : 1;
    const jvNumber = `${prefix} - ${String(nextNumber).padStart(5, '0')}`;

    // Step 4: Resolve account IDs and prepare details
    const resolvedDetails = await Promise.all(
      details.map(async (detail) => {
        // Resolve the account using accountNumber
        const account = await this.accountRepository.findOne({
          where: { accountNumber: detail.accountNumber },
        });
        if (!account) {
          throw new NotFoundException(
            `Account with number ${detail.accountNumber} not found.`,
          );
        }

        // Map the detail data to the entity
        return this.journalVoucherDetailRepository.create({
          account, // Associate the Account entity
          check: detail.check || null,
          checkDate: detail.checkDate || null,
          bankName: detail.bankName || null,
          description: detail.description,
          dr: parseFloat(detail.debit),
          drUSD: parseFloat(detail.debitUSD),
          drLL: parseFloat(detail.debitLL),
          cr: parseFloat(detail.credit),
          crUSD: parseFloat(detail.creditUSD),
          crLL: parseFloat(detail.creditLL),
          currency: detail.currency,
          exRateEUROToUSD: parseFloat(detail.exchangeRateEURtoUSD),
          exRateUSD: parseFloat(detail.exchangeRate),
          docNbr: detail.docNbr || null,
          exchangeRateAcc: null, // Populate based on additional logic if needed
          exchangeRateUSD: null, // Populate based on additional logic if needed
        });
      }),
    );

    // Step 5: Calculate totals
    const totalDr = resolvedDetails.reduce((sum, d) => sum + d.dr, 0);
    const totalDrUSD = resolvedDetails.reduce((sum, d) => sum + d.drUSD, 0);
    const totalDrLL = resolvedDetails.reduce((sum, d) => sum + d.drLL, 0);
    const totalCr = resolvedDetails.reduce((sum, d) => sum + d.cr, 0);
    const totalCrUSD = resolvedDetails.reduce((sum, d) => sum + d.crUSD, 0);
    const totalCrLL = resolvedDetails.reduce((sum, d) => sum + d.crLL, 0);

    // Step 6: Create and save the JournalVoucher entity
    const journalVoucher = this.journalVoucherRepository.create({
      date,
      jvType,
      jvNumber,
      totalDr,
      totalDrUSD,
      totalDrLL,
      totalCr,
      totalCrUSD,
      totalCrLL,
      details: resolvedDetails,
    });

    return this.journalVoucherRepository.save(journalVoucher);
  }

  async getAllJournalVouchers(): Promise<JournalVoucher[]> {
    return this.journalVoucherRepository.find({
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
  }

  async getJournalVoucherById(id: number): Promise<JournalVoucher> {
    const journalVoucher = await this.journalVoucherRepository.findOne({
      where: { id },
      relations: ['account', 'exchangeRateAcc', 'exchangeRateUSD', 'details'],
    });
    if (!journalVoucher) {
      throw new NotFoundException(`Journal Voucher with ID ${id} not found.`);
    }
    return journalVoucher;
  }

  async updateJournalVoucher(
    id: number,
    data: Partial<JournalVoucher>,
  ): Promise<JournalVoucher> {
    const journalVoucher = await this.getJournalVoucherById(id);
    Object.assign(journalVoucher, data);
    return this.journalVoucherRepository.save(journalVoucher);
  }

  async deleteJournalVoucher(id: number): Promise<void> {
    const journalVoucher = await this.getJournalVoucherById(id);
    await this.journalVoucherRepository.remove(journalVoucher);
  }
}
