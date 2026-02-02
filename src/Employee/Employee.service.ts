// src/employees/employees.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from '../entities/Employee.entity';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepository: Repository<Employee>,
  ) {}

  /**
   * Create a new employee
   */
  async create(createEmployeeDto: any): Promise<any> {
    const employee = this.employeeRepository.create({
      name: createEmployeeDto.name,
      nationality: createEmployeeDto.nationality,
      position: createEmployeeDto.position,
      phone: createEmployeeDto.phone,
      passportNumber: createEmployeeDto.passportNumber,
      passportIssueDate: createEmployeeDto.passportIssueDate 
        ? new Date(createEmployeeDto.passportIssueDate) 
        : null,
      passportExpiryDate: new Date(createEmployeeDto.passportExpiryDate),
      iqamaNumber: createEmployeeDto.iqamaNumber,
      iqamaIssueDate: createEmployeeDto.iqamaIssueDate 
        ? new Date(createEmployeeDto.iqamaIssueDate) 
        : null,
      iqamaExpiryDate: new Date(createEmployeeDto.iqamaExpiryDate),
      files: createEmployeeDto.files || [],
    });

    const saved = await this.employeeRepository.save(employee);
    return this.toResponseDto(saved);
  }

  /**
   * Get all employees
   */
  async findAll(): Promise<any[]> {
    const employees = await this.employeeRepository.find({
      order: { name: 'ASC' },
    });
    return employees.map(emp => this.toResponseDto(emp));
  }

  /**
   * Get one employee by ID
   */
  async findOne(id: number): Promise<any> {
    const employee = await this.employeeRepository.findOne({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return this.toResponseDto(employee);
  }

  /**
   * Update an employee
   */
  async update(id: number, updateEmployeeDto: any): Promise<any> {
    const employee = await this.employeeRepository.findOne({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    // Update fields
    if (updateEmployeeDto.name) employee.name = updateEmployeeDto.name;
    if (updateEmployeeDto.nationality) employee.nationality = updateEmployeeDto.nationality;
    if (updateEmployeeDto.position !== undefined) employee.position = updateEmployeeDto.position;
    if (updateEmployeeDto.phone !== undefined) employee.phone = updateEmployeeDto.phone;

    // Passport
    if (updateEmployeeDto.passportNumber !== undefined) 
      employee.passportNumber = updateEmployeeDto.passportNumber;
    if (updateEmployeeDto.passportIssueDate !== undefined) 
      employee.passportIssueDate = updateEmployeeDto.passportIssueDate 
        ? new Date(updateEmployeeDto.passportIssueDate) 
        : null;
    if (updateEmployeeDto.passportExpiryDate) 
      employee.passportExpiryDate = new Date(updateEmployeeDto.passportExpiryDate);

    // Iqama
    if (updateEmployeeDto.iqamaNumber !== undefined) 
      employee.iqamaNumber = updateEmployeeDto.iqamaNumber;
    if (updateEmployeeDto.iqamaIssueDate !== undefined) 
      employee.iqamaIssueDate = updateEmployeeDto.iqamaIssueDate 
        ? new Date(updateEmployeeDto.iqamaIssueDate) 
        : null;
    if (updateEmployeeDto.iqamaExpiryDate) 
      employee.iqamaExpiryDate = new Date(updateEmployeeDto.iqamaExpiryDate);

    // Files
    if (updateEmployeeDto.files !== undefined) 
      employee.files = updateEmployeeDto.files;

    const saved = await this.employeeRepository.save(employee);
    return this.toResponseDto(saved);
  }

  /**
   * Delete an employee
   */
  async remove(id: number): Promise<void> {
    const result = await this.employeeRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
  }

  /**
   * Add files to an employee
   */
  async addFiles(id: number, files: Array<Express.Multer.File>): Promise<any> {
    const employee = await this.employeeRepository.findOne({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    // Map uploaded files to file metadata
    const newFiles = files.map(file => ({
      name: file.originalname,
      type: file.mimetype.includes('pdf') ? 'PDF' : 'Image',
      url: `/uploads/employees/${file.filename}`,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    }));

    // Add to existing files
    employee.files = [...(employee.files || []), ...newFiles];
    
    const saved = await this.employeeRepository.save(employee);
    return this.toResponseDto(saved);
  }

  /**
   * Delete a file from an employee
   */
  async deleteFile(employeeId: number, fileName: string): Promise<any> {
    const employee = await this.employeeRepository.findOne({ where: { id: employeeId } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${employeeId} not found`);
    }

    // Remove file from array
    employee.files = (employee.files || []).filter(file => file.name !== fileName);
    
    const saved = await this.employeeRepository.save(employee);
    return this.toResponseDto(saved);
  }

  /**
   * Get alerts for expiring/expired documents
   */
  async getAlerts(): Promise<any[]> {
    const employees = await this.employeeRepository.find();
    const alerts: any[] = [];
    const today = new Date();

    for (const emp of employees) {
      // Check passport
      const passportDays = this.calculateDaysUntilExpiry(emp.passportExpiryDate, today);
      if (passportDays <= 90) {
        alerts.push({
          employee: emp.name,
          employeeId: emp.id,
          document: 'Passport',
          days: passportDays,
          urgent: passportDays <= 30,
        });
      }

      // Check iqama
      const iqamaDays = this.calculateDaysUntilExpiry(emp.iqamaExpiryDate, today);
      if (iqamaDays <= 90) {
        alerts.push({
          employee: emp.name,
          employeeId: emp.id,
          document: 'Work Permit (إقامة)',
          days: iqamaDays,
          urgent: iqamaDays <= 30,
        });
      }
    }

    // Sort by days (most urgent first)
    alerts.sort((a, b) => a.days - b.days);

    return alerts;
  }

  /**
   * Get employees by filter (valid, expiring, expired)
   */
  async findByStatus(status: 'valid' | 'expiring' | 'expired'): Promise<any[]> {
    const employees = await this.employeeRepository.find();
    const today = new Date();

    const filtered = employees.filter(emp => {
      const passportStatus = this.getDocumentStatus(emp.passportExpiryDate, today);
      const iqamaStatus = this.getDocumentStatus(emp.iqamaExpiryDate, today);

      if (status === 'expired') {
        return passportStatus === 'expired' || iqamaStatus === 'expired';
      } else if (status === 'expiring') {
        return passportStatus === 'expiring' || iqamaStatus === 'expiring';
      } else if (status === 'valid') {
        return passportStatus === 'valid' && iqamaStatus === 'valid';
      }
      return false;
    });

    return filtered.map(emp => this.toResponseDto(emp));
  }

  /**
   * Search employees by name or nationality
   */
  async search(searchTerm: string): Promise<any[]> {
    const employees = await this.employeeRepository
      .createQueryBuilder('employee')
      .where('LOWER(employee.name) LIKE LOWER(:searchTerm)', { 
        searchTerm: `%${searchTerm}%` 
      })
      .orWhere('LOWER(employee.nationality) LIKE LOWER(:searchTerm)', { 
        searchTerm: `%${searchTerm}%` 
      })
      .orderBy('employee.name', 'ASC')
      .getMany();

    return employees.map(emp => this.toResponseDto(emp));
  }

  /**
   * Convert entity to response DTO
   */
  private toResponseDto(employee: Employee): any {
    return {
      id: employee.id,
      name: employee.name,
      nationality: employee.nationality,
      position: employee.position,
      phone: employee.phone,
      passport: {
        number: employee.passportNumber,
        issueDate: employee.passportIssueDate 
          ? (employee.passportIssueDate instanceof Date 
              ? employee.passportIssueDate.toISOString().split('T')[0]
              : employee.passportIssueDate)
          : null,
        expiryDate: employee.passportExpiryDate instanceof Date
          ? employee.passportExpiryDate.toISOString().split('T')[0]
          : employee.passportExpiryDate,
      },
      iqama: {
        number: employee.iqamaNumber,
        issueDate: employee.iqamaIssueDate 
          ? (employee.iqamaIssueDate instanceof Date 
              ? employee.iqamaIssueDate.toISOString().split('T')[0]
              : employee.iqamaIssueDate)
          : null,
        expiryDate: employee.iqamaExpiryDate instanceof Date
          ? employee.iqamaExpiryDate.toISOString().split('T')[0]
          : employee.iqamaExpiryDate,
      },
      files: employee.files || [],
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
  }

  /**
   * Calculate days until expiry
   */
  private calculateDaysUntilExpiry(expiryDate: Date, today: Date): number {
    const expiry = new Date(expiryDate);
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Get document status
   */
  private getDocumentStatus(expiryDate: Date, today: Date): 'valid' | 'expiring' | 'expired' {
    const daysLeft = this.calculateDaysUntilExpiry(expiryDate, today);
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= 90) return 'expiring';
    return 'valid';
  }
}