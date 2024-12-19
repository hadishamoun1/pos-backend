import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { Account } from '../entities/account.entity';
import { Currency } from '../entities/currency.entity';

@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    @InjectRepository(Currency)
    private currencyRepository: Repository<Currency>,
  ) {}

  async createCustomer(customerData: Partial<Customer>): Promise<Customer> {
    const { customerName, currencyId, ...otherFields } = customerData;

    // Validate currency
    const currency = await this.currencyRepository.findOne({
      where: { id: currencyId },
    });
    if (!currency) {
      throw new NotFoundException(`Currency with ID ${currencyId} not found.`);
    }

    // Generate customer account number
    const accountPrefix = '4111';
    const lastCustomer = await this.customerRepository.find({
      where: { customerAccountNumber: Like(`${accountPrefix}%`) },
      order: { customerAccountNumber: 'DESC' },
      take: 1,
    });

    const newCustomerNumber =
      lastCustomer.length > 0
        ? parseInt(
            lastCustomer[0].customerAccountNumber.replace(accountPrefix, ''),
          ) + 1
        : 1;

    const customerAccountNumber = `${accountPrefix}${newCustomerNumber.toString().padStart(4, '0')}`;

    // Link to the 4111 account
    const account = await this.accountRepository.findOne({
      where: { accountNumber: accountPrefix },
    });
    if (!account) {
      throw new NotFoundException(
        `Account with number ${accountPrefix} not found.`,
      );
    }

    // Create customer
    const customer = this.customerRepository.create({
      customerAccountNumber,
      customerName,
      currency,
      account,
      ...otherFields,
    });

    return this.customerRepository.save(customer);
  }

  async getAllCustomers(): Promise<Customer[]> {
    return this.customerRepository.find({ relations: ['currency', 'account'] });
  }

  async getCustomerById(id: number): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { id },
      relations: ['currency', 'account'],
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found.`);
    }
    return customer;
  }
  async getCustomersPaginated(
    page: number,
    limit: number,
  ): Promise<{ customers: Customer[]; total: number }> {
    const [customers, total] = await this.customerRepository.findAndCount({
      relations: ['currency', 'account'], // Include relations if needed
      skip: (page - 1) * limit,
      take: limit,
    });
  
    return { customers, total };
  }
}
