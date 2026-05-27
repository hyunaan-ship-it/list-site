import React, { useState, useEffect, useCallback, useRef } from 'react';

// ==========================================
// CONFIRM MODAL (replaces window.confirm which is blocked on GitHub Pages)
// ==========================================
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
    }}>
      <div style={{
        backgroundColor: '#fff', borderRadius: '12px', padding: '2rem',
        maxWidth: '420px', width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        fontFamily: 'var(--font-primary)'
      }}>
        <p style={{ fontSize: '1.05rem', fontWeight: '700', color: '#1e293b', marginBottom: '1.5rem', lineHeight: 1.6 }}>
          {message}
        </p>
        <div style={{ display: 'flex', gap: '0.8rem', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{
            padding: '0.5rem 1.2rem', border: '2px solid #cbd5e1',
            borderRadius: '8px', cursor: 'pointer', fontWeight: '700',
            backgroundColor: '#f8fafc', color: '#64748b', fontSize: '0.95rem'
          }}>취소</button>
          <button onClick={onConfirm} style={{
            padding: '0.5rem 1.2rem', border: 'none',
            borderRadius: '8px', cursor: 'pointer', fontWeight: '700',
            backgroundColor: '#dc2626', color: '#fff', fontSize: '0.95rem'
          }}>확인</button>
        </div>
      </div>
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api/v1`
  : window.location.origin.includes(':5173')
    ? 'http://localhost:5000/api/v1'
    : '/api/v1';

// Custom robust fetch helper to support credentials: 'include' for secure session cookies
const customFetch = async (url, options = {}) => {
  const mergedOptions = {
    ...options,
    credentials: 'include',
  };

  if (options.body && typeof options.body === 'object') {
    mergedOptions.body = JSON.stringify(options.body);
    mergedOptions.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
  } else if (options.body) {
    mergedOptions.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
  }

  const res = await fetch(url, mergedOptions);
  
  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }

  if (res.status === 401) {
    // Session is invalid/expired - dispatch event to seamlessly redirect back to login page
    window.dispatchEvent(new CustomEvent('unauthorized-api'));
  }

  if (!res.ok) {
    throw new Error(data.error || `서버 요청 실패 (상태 코드: ${res.status})`);
  }
  return data;
};

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('LOGIN'); // LOGIN, LEADER, ADMIN
  const [alert, setAlert] = useState(null);
  const [confirm, setConfirm] = useState(null); // { message, resolve }

  // useConfirm: replaces window.confirm safely on GitHub Pages
  const useConfirm = useCallback(() => {
    return (message) => new Promise((resolve) => {
      setConfirm({ message, resolve });
    });
  }, []);
  const showConfirm = useConfirm();

  const triggerAlert = (type, message) => {
    setAlert({ type, message });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      setAlert(null);
    }, 8000);
  };

  useEffect(() => {
    customFetch(`${API_BASE}/auth/me`)
      .then(data => {
        if (data.user) {
          setUser(data.user);
          setPage(data.user.role === 'ADMIN' ? 'ADMIN' : 'LEADER');
        }
        setLoading(false);
      })
      .catch(err => {
        console.log('No active session.');
        setLoading(false);
      });
  }, []);

  // Set up global unauthorized session event listener
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setPage('LOGIN');
      triggerAlert('danger', '세션이 만료되거나 로그아웃되어 자동으로 안전하게 로그인 페이지로 이동합니다. 다시 로그인해주세요.');
    };
    window.addEventListener('unauthorized-api', handleUnauthorized);
    return () => window.removeEventListener('unauthorized-api', handleUnauthorized);
  }, []);

  const handleLogout = async () => {
    try {
      await customFetch(`${API_BASE}/auth/logout`, { method: 'POST' });
      setUser(null);
      setPage('LOGIN');
      triggerAlert('info', '정상적으로 로그아웃되었습니다.');
    } catch (error) {
      console.error('Logout error:', error);
      triggerAlert('danger', '로그아웃 도중 오류가 발생했습니다.');
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        fontFamily: 'var(--font-primary)'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '5px solid #cbd5e1',
          borderTop: '5px solid #1e3a8a',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          marginBottom: '1rem'
        }} />
        <h2 style={{ color: '#1e3a8a' }}>시스템 불러오는 중...</h2>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div className="app-container">
      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={() => { const r = confirm.resolve; setConfirm(null); r(true); }}
          onCancel={() => { const r = confirm.resolve; setConfirm(null); r(false); }}
        />
      )}
      {/* Header */}
      {user && (
        <header className="main-header">
          <div className="header-logo">
            <span style={{ fontSize: '1.8rem' }}>🏢</span>
            <span>사내 직무 교육 통합 예약 시스템</span>
          </div>
          <div className="header-userinfo">
            <div className="user-badge">
              🔑 <strong>{user.name}</strong> {user.position} ({user.department}) - {user.role === 'ADMIN' ? '운영진' : '리더'}
            </div>
            {user.role === 'ADMIN' && (
              <button 
                className="huge-btn-secondary" 
                style={{ padding: '0.5rem 1.2rem', fontSize: '1rem', width: 'auto', borderRadius: '10px', fontWeight: '800' }}
                onClick={() => setPage(page === 'ADMIN' ? 'LEADER' : 'ADMIN')}
              >
                {page === 'ADMIN' ? '리더 모드 전환' : '관리자 대시보드'}
              </button>
            )}
            <button className="logout-btn" onClick={handleLogout}>로그아웃</button>
          </div>
        </header>
      )}

      {/* Alert Banner */}
      {alert && (
        <div style={{ padding: '1rem 2rem', maxWidth: '1400px', width: '100%', margin: '1rem auto 0 auto' }}>
          <div className={`alert-banner alert-${alert.type === 'success' ? 'success' : alert.type === 'danger' ? 'danger' : 'info'}`}>
            {alert.type === 'success' ? '✅' : alert.type === 'danger' ? '❌' : 'ℹ️'} {alert.message}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '2rem' }}>
        {page === 'LOGIN' && <Login setUser={setUser} setPage={setPage} triggerAlert={triggerAlert} />}
        {page === 'LEADER' && <LeaderPortal user={user} triggerAlert={triggerAlert} showConfirm={showConfirm} />}
        {page === 'ADMIN' && <AdminDashboard user={user} triggerAlert={triggerAlert} showConfirm={showConfirm} />}
      </main>

      {/* Footer */}
      <footer style={{
        backgroundColor: '#1e293b',
        color: '#94a3b8',
        textAlign: 'center',
        padding: '1.5rem',
        marginTop: 'auto',
        borderTop: '1px solid #334155'
      }}>
        <p>© 2026 사내 교육 관리 시스템. All Rights Reserved. (운영진 강제 정원초과 접수 지원 | 글로벌 중복신청 완전 방지)</p>
      </footer>
    </div>
  );
}

// ==========================================
// 1. LOGIN COMPONENT
// ==========================================
function Login({ setUser, setPage, triggerAlert }) {
  const [empId, setEmpId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!empId || !password) {
      triggerAlert('danger', '사번과 비밀번호를 모두 입력해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const data = await customFetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        body: { emp_id: empId, password }
      });

      setUser(data.user);
      setPage(data.user.role === 'ADMIN' ? 'ADMIN' : 'LEADER');
      triggerAlert('success', `${data.user.name}님, 반갑습니다! 로그인되었습니다.`);
    } catch (err) {
      triggerAlert('danger', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      maxWidth: '480px',
      margin: '4rem auto',
      backgroundColor: 'var(--bg-card)',
      borderRadius: 'var(--border-radius)',
      border: '3px solid var(--border-color)',
      padding: '2.5rem',
      boxShadow: 'var(--shadow-lg)'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <span style={{ fontSize: '3.5rem' }}>🏢</span>
        <h1 style={{ marginTop: '1rem', color: 'var(--color-primary)' }}>직무 교육 일정 관리</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1.15rem', marginTop: '0.5rem' }}>
          차수별 최대 60명 자동 마감 등록 포털
        </p>
      </div>

      <div className="alert-banner alert-info" style={{ marginBottom: '1.5rem', fontSize: '0.95rem' }}>
        📢 <strong>안내 :</strong> 초기 비밀번호는 <strong>lg[본인사번]</strong>입니다. (예: 사번이 123456이면 lg123456)
      </div>

      <form onSubmit={handleSubmit}>
        <div className="huge-input-wrapper">
          <label className="huge-label" htmlFor="empId">사번 (Employee ID)</label>
          <input
            id="empId"
            className="huge-input"
            type="text"
            placeholder="사번 6~8자리 입력"
            value={empId}
            onChange={e => setEmpId(e.target.value)}
            disabled={submitting}
            autoFocus
          />
        </div>

        <div className="huge-input-wrapper">
          <label className="huge-label" htmlFor="password">비밀번호 (Password)</label>
          <input
            id="password"
            className="huge-input"
            type="password"
            placeholder="초기비밀번호: lg[사번]"
            value={password}
            onChange={e => setPassword(e.target.value)}
            disabled={submitting}
          />
        </div>

        <button 
          className="huge-btn huge-btn-primary" 
          type="submit"
          disabled={submitting}
          style={{ marginTop: '1rem' }}
        >
          {submitting ? '로그인 처리 중...' : '로그인 하기 🔓'}
        </button>
      </form>
    </div>
  );
}

// ==========================================
// 2. LEADER PORTAL COMPONENT
// ==========================================
function LeaderPortal({ user, triggerAlert, showConfirm }) {
  const [schedules, setSchedules] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  // Region Tab State (1차 트리 선택)
  const [selectedRegion, setSelectedRegion] = useState('수도권');

  // Active Session Selection (2차 일정 선택)
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  
  // Spreadsheet Grid State
  const [gridRows, setGridRows] = useState([]);
  const [submittingBulk, setSubmittingBulk] = useState(false);

  // Bottom Integrated Table Batch Updates state
  const [pendingUpdates, setPendingUpdates] = useState({}); 
  const [savingBulkUpdates, setSavingBulkUpdates] = useState(false);

  // Real-time Filters for bottom table
  const [filterSession, setFilterSession] = useState('ALL');
  const [filterQuery, setFilterQuery] = useState('');

  const DEFAULT_ROW_COUNT = 15;
  const isAdmin = user.role === 'ADMIN';

  // Dynamic schedule title formatter based on chronological date sorted order within region
  const getDynamicTitle = (sch, allSchedules) => {
    if (!sch) return '';
    const region = sch.region || '수도권';
    const sorted = [...allSchedules]
      .filter(s => (s.region || '수도권') === region)
      .sort((a, b) => a.training_date.localeCompare(b.training_date));
    const idx = sorted.findIndex(s => s.date_id === sch.date_id);
    const mmdd = sch.training_date.split('-').slice(1).join('.');
    return `${idx !== -1 ? idx + 1 : 1}차수 (${mmdd})`;
  };

  const fetchData = async () => {
    try {
      const [schedData, regData] = await Promise.all([
        customFetch(`${API_BASE}/schedule`),
        customFetch(`${API_BASE}/registration`)
      ]);

      // Always ensure chronologically sorted order
      const sortedSchedules = [...schedData].sort((a, b) => a.training_date.localeCompare(b.training_date));

      setSchedules(sortedSchedules);
      setRegistrations(regData);

      // Filtered by current region for initial selection
      const regionSchedules = sortedSchedules.filter(s => (s.region || '수도권') === selectedRegion);

      if (regionSchedules.length > 0 && !selectedSchedule) {
        setSelectedSchedule(regionSchedules[0]);
      } else if (selectedSchedule) {
        const updated = sortedSchedules.find(s => s.date_id === selectedSchedule.date_id);
        if (updated) setSelectedSchedule(updated);
      }
    } catch (error) {
      console.error('Fetch portal data error:', error);
      triggerAlert('danger', error.message || '데이터 로드 중 실패');
    } finally {
      setLoadingData(false);
    }
  };

  // Trigger when selectedRegion changes to auto-select the first schedule in that region
  useEffect(() => {
    if (schedules.length > 0) {
      const regionSchedules = schedules.filter(s => (s.region || '수도권') === selectedRegion);
      if (regionSchedules.length > 0) {
        setSelectedSchedule(regionSchedules[0]);
      } else {
        setSelectedSchedule(null);
      }
    }
  }, [selectedRegion, schedules]);

  useEffect(() => {
    fetchData();
  }, []);

  // Initialize spreadsheet grid empty rows when session changes
  useEffect(() => {
    if (selectedSchedule) {
      const initialRows = Array.from({ length: DEFAULT_ROW_COUNT }, () => ({
        emp_id: '',
        name: '',
        gender: '',
        phone: '',
        status: 'EMPTY',
        errorMsg: ''
      }));
      setGridRows(initialRows);
    }
  }, [selectedSchedule]);

  const getRegCount = (dateId) => {
    const sch = schedules.find(s => s.date_id === dateId);
    return sch ? (sch.current_count || 0) : 0;
  };

  const handleAddRows = () => {
    const additionalRows = Array.from({ length: 10 }, () => ({
      emp_id: '',
      name: '',
      gender: '',
      phone: '',
      status: 'EMPTY',
      errorMsg: ''
    }));
    setGridRows([...gridRows, ...additionalRows]);
  };

  const handleClearRow = (index) => {
    const nextRows = [...gridRows];
    nextRows[index] = {
      emp_id: '',
      name: '',
      gender: '',
      phone: '',
      status: 'EMPTY',
      errorMsg: ''
    };
    setGridRows(nextRows);
  };

  const lookupEmployee = async (empId, index, currentRows = gridRows) => {
    const cleanId = String(empId).trim();
    if (!cleanId) return;

    try {
      const data = await customFetch(`${API_BASE}/employee/${cleanId}`);
      const nextRows = [...currentRows];

      // Enforce global duplication prevention!
      if (data.registered_session) {
        nextRows[index] = {
          ...nextRows[index],
          emp_id: cleanId,
          name: data.name,
          gender: data.gender,
          phone: data.phone,
          status: 'DUPLICATE',
          errorMsg: `이미 ${data.registered_session}에 등록됨`
        };
      } else {
        nextRows[index] = {
          ...nextRows[index],
          emp_id: cleanId,
          name: data.name,
          gender: data.gender,
          phone: data.phone,
          status: 'VERIFIED',
          errorMsg: ''
        };
      }
      setGridRows(nextRows);
    } catch (err) {
      const nextRows = [...currentRows];
      nextRows[index] = {
        ...nextRows[index],
        emp_id: cleanId,
        name: '',
        gender: '',
        phone: '',
        status: 'ERROR',
        errorMsg: err.message || '미등록 사번'
      };
      setGridRows(nextRows);
    }
  };

  const handleEmpIdChange = (index, value) => {
    const nextRows = [...gridRows];
    nextRows[index].emp_id = value;
    
    if (!value.trim()) {
      nextRows[index] = {
        emp_id: '',
        name: '',
        gender: '',
        phone: '',
        status: 'EMPTY',
        errorMsg: ''
      };
      setGridRows(nextRows);
      return;
    }
    
    setGridRows(nextRows);

    if (/^\d{6,8}$/.test(value.trim())) {
      lookupEmployee(value.trim(), index, nextRows);
    }
  };

  const handleEmpIdBlur = (index) => {
    const empId = gridRows[index].emp_id.trim();
    if (empId && gridRows[index].status === 'EMPTY') {
      lookupEmployee(empId, index);
    }
  };

  const handleEmpIdPaste = async (index, e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text');
    if (!pastedData) return;

    const lines = pastedData.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length === 0) return;

    const nextRows = [...gridRows];
    const empIdsToLookup = [];
    const lookupIndexes = [];

    lines.forEach((line, offset) => {
      const targetIndex = index + offset;
      if (targetIndex >= nextRows.length) {
        nextRows.push({
          emp_id: '',
          name: '',
          gender: '',
          phone: '',
          status: 'EMPTY',
          errorMsg: ''
        });
      }

      const cells = line.split('\t').map(c => c.trim());
      const numCell = cells.find(cell => /^\d{5,8}$/.test(cell));
      const empId = numCell || cells[0].replace(/\D/g, ''); 

      if (empId) {
        nextRows[targetIndex].emp_id = empId;
        nextRows[targetIndex].status = 'PENDING';
        empIdsToLookup.push(empId);
        lookupIndexes.push(targetIndex);
      }
    });

    setGridRows(nextRows);

    if (empIdsToLookup.length === 0) return;

    try {
      const employeeMap = await customFetch(`${API_BASE}/employee/bulk-lookup`, {
        method: 'POST',
        body: { emp_ids: empIdsToLookup }
      });

      const finalRows = [...nextRows];
      lookupIndexes.forEach((gridIndex, offset) => {
        const empId = empIdsToLookup[offset];
        const match = employeeMap[empId];

        if (match) {
          if (match.registered_session) {
            finalRows[gridIndex] = {
              ...finalRows[gridIndex],
              emp_id: empId,
              name: match.name,
              gender: match.gender,
              phone: match.phone,
              status: 'DUPLICATE',
              errorMsg: `이미 ${match.registered_session}에 등록됨`
            };
          } else {
            finalRows[gridIndex] = {
              ...finalRows[gridIndex],
              emp_id: empId,
              name: match.name,
              gender: match.gender,
              phone: match.phone,
              status: 'VERIFIED',
              errorMsg: ''
            };
          }
        } else {
          finalRows[gridIndex] = {
            ...finalRows[gridIndex],
            emp_id: empId,
            name: '',
            gender: '',
            phone: '',
            status: 'ERROR',
            errorMsg: '미등록 사번'
          };
        }
      });

      setGridRows(finalRows);
      triggerAlert('success', `엑셀로부터 ${empIdsToLookup.length}명의 사원 복사 붙여넣기 완료 및 조회가 진행되었습니다.`);
    } catch (error) {
      console.error(error);
      triggerAlert('danger', '대량 검증 조회 중 오류가 발생했습니다.');
    }
  };

  const handleBulkSubmit = async () => {
    const validRows = gridRows.filter(r => r.status === 'VERIFIED');
    if (validRows.length === 0) {
      triggerAlert('danger', '예약 등록할 수 있는 유효한 상태(✅확인완료)의 사번 정보가 없습니다.');
      return;
    }

    const currentCount = getRegCount(selectedSchedule.date_id);
    const limit = selectedSchedule.max_capacity || 60;
    const remainingSpots = limit - currentCount;

    if (!isAdmin && validRows.length > remainingSpots) {
      triggerAlert('danger', `신청 인원이 남은 정원(${remainingSpots}명)을 초과합니다. 표에서 초과 인원을 제외해 주세요.`);
      return;
    }

    setSubmittingBulk(true);
    try {
      const data = await customFetch(`${API_BASE}/registration/bulk`, {
        method: 'POST',
        body: {
          date_id: selectedSchedule.date_id,
          registrations: validRows.map(r => ({
            emp_id: r.emp_id,
            parent_center: '',
            sub_center: ''
          }))
        }
      });

      triggerAlert('success', `🎉 ${data.message}`);
      
      const initialRows = Array.from({ length: DEFAULT_ROW_COUNT }, () => ({
        emp_id: '',
        name: '',
        gender: '',
        phone: '',
        status: 'EMPTY',
        errorMsg: ''
      }));
      setGridRows(initialRows);

      fetchData();
    } catch (error) {
      triggerAlert('danger', error.message);
    } finally {
      setSubmittingBulk(false);
    }
  };

  const handleBulkSaveUpdates = async () => {
    const updatesList = [];
    Object.entries(pendingUpdates).forEach(([regId, newDateId]) => {
      const orig = registrations.find(r => r.reg_id === Number(regId));
      if (orig && orig.date_id !== newDateId) {
        updatesList.push({ reg_id: Number(regId), date_id: newDateId });
      }
    });

    if (updatesList.length === 0) {
      triggerAlert('info', '변경된 예약 정보가 없습니다.');
      return;
    }

    setSavingBulkUpdates(true);
    try {
      const data = await customFetch(`${API_BASE}/registration/bulk-update`, {
        method: 'POST',
        body: { updates: updatesList }
      });

      triggerAlert('success', `✨ ${data.message}`);
      setPendingUpdates({});
      fetchData();
    } catch (error) {
      triggerAlert('danger', error.message);
    } finally {
      setSavingBulkUpdates(false);
    }
  };

  const handleCancelRegistration = async (regId, empName) => {
    const ok = await showConfirm(`${empName}님의 예약 신청을 취소하시겠습니까?`);
    if (!ok) return;

    try {
      const data = await customFetch(`${API_BASE}/registration/${regId}`, {
        method: 'DELETE'
      });

      const nextPending = { ...pendingUpdates };
      delete nextPending[regId];
      setPendingUpdates(nextPending);

      triggerAlert('success', data.message);
      fetchData();
    } catch (error) {
      triggerAlert('danger', error.message);
    }
  };

  if (loadingData) {
    return <div style={{ fontSize: '1.3rem', textAlign: 'center', padding: '3rem' }}>로딩 중...</div>;
  }

  const currentRegCount = selectedSchedule ? getRegCount(selectedSchedule.date_id) : 0;
  const maxLimit = selectedSchedule ? (selectedSchedule.max_capacity || 60) : 60;
  
  const isFull = !isAdmin && (currentRegCount >= maxLimit);
  const verifiedCount = gridRows.filter(r => r.status === 'VERIFIED').length;
  const isOver = !isAdmin && (verifiedCount > (maxLimit - currentRegCount));

  const unsavedCount = Object.entries(pendingUpdates).filter(([regId, newDateId]) => {
    const orig = registrations.find(r => r.reg_id === Number(regId));
    return orig && orig.date_id !== newDateId;
  }).length;

  const filteredRegs = registrations.filter(reg => {
    const matchSession = filterSession === 'ALL' || String(reg.date_id) === filterSession;
    const matchQuery = !filterQuery.trim() || 
      reg.emp_name.toLowerCase().includes(filterQuery.toLowerCase()) ||
      reg.emp_id.includes(filterQuery.trim()) ||
      (reg.emp_phone && reg.emp_phone.includes(filterQuery.trim())) ||
      (reg.emp_dept && reg.emp_dept.toLowerCase().includes(filterQuery.toLowerCase())) ||
      (reg.emp_position && reg.emp_position.toLowerCase().includes(filterQuery.toLowerCase()));
    return matchSession && matchQuery;
  });

  return (
    <div className="portal-container">
      
      {/* Title */}
      <div className="portal-title-section">
        <h2 style={{ fontSize: '1.6rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          📋 직무 교육 예약 관리 및 실시간 등록 포털
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginTop: '0.1rem' }}>
          글로벌 정원제한 (A, B, C 리더 신청인원 통합 60명 자동 마감 카운트) | 글로벌 중복 신청 완전 방지
        </p>
      </div>

      {/* Side by Side Portal Layout */}
      <div className="portal-split-layout">
        
        {/* Left Column: Vertical stack of schedules with global counts */}
        <aside className="portal-left-sidebar">
          <div className="sidebar-title">
            <span>📅</span> 지역 & 교육 차수 선택
          </div>
          
          {/* 1차 트리: 지역 선택 탭 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', padding: '0.5rem', backgroundColor: '#f1f5f9', borderBottom: '1px solid var(--border-color)' }}>
            {['수도권', '중부&강원실', '서부&충청실', '남부'].map(r => (
              <button
                key={r}
                onClick={() => setSelectedRegion(r)}
                style={{
                  flex: 1,
                  padding: '0.4rem 0.2rem',
                  fontSize: '0.8rem',
                  fontWeight: '800',
                  borderRadius: '6px',
                  border: selectedRegion === r ? '2px solid var(--color-primary)' : '1px solid #cbd5e1',
                  backgroundColor: selectedRegion === r ? 'var(--color-primary)' : '#ffffff',
                  color: selectedRegion === r ? '#ffffff' : '#475569',
                  cursor: 'pointer',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease'
                }}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="sidebar-session-list" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            {schedules
              .filter(sch => (sch.region || '수도권') === selectedRegion)
              .map(sch => {
                const count = sch.current_count || 0; 
                const limit = sch.max_capacity || 60;
                const full = count >= limit;
                const isSelected = selectedSchedule?.date_id === sch.date_id;
                const dynamicTitle = getDynamicTitle(sch, schedules);
                
                return (
                  <button
                    key={sch.date_id}
                    className={`sidebar-session-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedSchedule(sch)}
                  >
                    <span style={{ fontSize: '1.05rem', fontWeight: '800', color: isSelected ? 'var(--color-primary-light)' : 'var(--text-main)' }}>
                      {dynamicTitle}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      일자: {sch.training_date}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem' }}>
                      <span style={{
                        padding: '0.1rem 0.4rem',
                        borderRadius: '8px',
                        fontSize: '0.75rem',
                        fontWeight: '700',
                        backgroundColor: full ? '#fee2e2' : '#dcfce7',
                        color: full ? 'var(--color-danger)' : 'var(--color-success)'
                      }}>
                        {full ? '마감 (제한초과)' : '접수중'}
                      </span>
                      <strong style={{ fontSize: '0.95rem', color: full ? 'var(--color-danger)' : 'var(--text-main)' }}>
                        {count} / {limit}명
                      </strong>
                    </div>
                  </button>
                );
              })}
            {schedules.filter(sch => (sch.region || '수도권') === selectedRegion).length === 0 && (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
                본 지역에 개설된 교육 차수가 없습니다.
              </div>
            )}
          </div>
        </aside>

        {/* Right Column: Split layout (Top Grid / Bottom List) */}
        <section className="portal-right-content">
          
          {/* Top Panel: Spreadsheet Grid */}
          <div className="portal-top-panel">
            {selectedSchedule && (
              <div className="panel-inner-container">
                <div className="panel-header">
                  <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📝 [{getDynamicTitle(selectedSchedule, schedules)}] 교육 대상자 등록 표
                  </h3>
                  <span style={{ fontSize: '1rem', fontWeight: '700', color: isFull ? 'var(--color-danger)' : 'var(--text-main)' }}>
                    전체 점유 현황: <strong>{currentRegCount}명</strong> / {maxLimit}명 (남은 자리: {maxLimit - currentRegCount}명)
                  </span>
                </div>

                {isFull ? (
                  <div className="employee-error-box" style={{ fontSize: '1.1rem', padding: '1.2rem' }}>
                    🔒 <strong>모집 완료 안내:</strong> 본 교육 차수는 60명 정원이 모두 점유되었습니다. 왼쪽에서 다른 일정을 선택해 주세요.
                  </div>
                ) : (
                  <div className="panel-content-flex">
                    <div className="alert-banner alert-info" style={{ fontSize: '0.85rem', padding: '0.5rem 0.8rem', marginBottom: '0.5rem' }}>
                      💡 <strong>대량 붙여넣기 팁:</strong> 사번 열 첫 입력칸 클릭 상태에서 엑셀의 [사번] 열 데이터를 복사(Ctrl+C) 후 붙여넣기(Ctrl+V) 하시면 성명, 성별, 연락처가 <strong>자동 기입</strong>됩니다.
                    </div>

                    {isAdmin && (
                      <div className="admin-override-notice">
                        🔓 <strong>운영진 강제 권한 활성화:</strong> 정원(60명) 한도를 초과하여 무제한 추가 강제 등록이 가능합니다.
                      </div>
                    )}

                    {/* Spreadsheet Table */}
                    <div className="table-container-compact">
                      <table className="custom-table">
                        <thead>
                          <tr>
                            <th style={{ width: '60px', textAlign: 'center' }}>No.</th>
                            <th className="col-empid" style={{ width: '130px' }}>사번</th>
                            <th style={{ width: '150px' }}>이름 (자동기입)</th>
                            <th style={{ width: '90px' }}>성별 (자동기입)</th>
                            <th style={{ width: '180px' }}>연락처 (자동기입)</th>
                            <th>검증 상태</th>
                            <th style={{ width: '80px', textAlign: 'center' }}>비우기</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gridRows.map((row, idx) => {
                            let statusColor = '#64748b';
                            let statusBg = '#e2e8f0';
                            let statusLabel = '🕒 미입력';
                            
                            if (row.status === 'VERIFIED') {
                              statusColor = 'var(--color-success)';
                              statusBg = '#dcfce7';
                              statusLabel = '✅ 검증성공';
                            } else if (row.status === 'INVALID') {
                              statusColor = 'var(--color-danger)';
                              statusBg = '#fee2e2';
                              statusLabel = '❌ 없는사번';
                            } else if (row.status === 'DUPLICATE') {
                              statusColor = '#ea580c';
                              statusBg = '#ffedd5';
                              statusLabel = `⚠️ ${row.registered_session || '신청됨'}`;
                            } else if (row.status === 'VALIDATING') {
                              statusColor = '#2563eb';
                              statusBg = '#dbeafe';
                              statusLabel = '🔄 조회중...';
                            }

                            return (
                              <tr key={idx}>
                                <td style={{ textAlign: 'center', fontWeight: '800', color: 'var(--text-muted)' }}>
                                  {idx + 1}
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="grid-input-active"
                                    placeholder="사번 입력/붙여넣기"
                                    value={row.emp_id}
                                    onChange={(e) => handleEmpIdChange(idx, e.target.value)}
                                    onBlur={() => handleEmpIdBlur(idx)}
                                    onPaste={(e) => handleEmpIdPaste(idx, e)}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="grid-input-disabled"
                                    style={{ fontWeight: '800', color: 'var(--color-primary)' }}
                                    value={row.name}
                                    disabled
                                  />
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="grid-input-disabled"
                                    value={row.gender}
                                    disabled
                                  />
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="grid-input-disabled"
                                    style={{ letterSpacing: '0.01em' }}
                                    value={row.phone}
                                    disabled
                                  />
                                </td>
                                <td>
                                  <span style={{
                                    display: 'inline-block',
                                    padding: '0.2rem 0.6rem',
                                    borderRadius: '12px',
                                    fontSize: '0.8rem',
                                    fontWeight: '700',
                                    backgroundColor: statusBg,
                                    color: statusColor
                                  }}>
                                    {statusLabel}
                                  </span>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                  <button
                                    type="button"
                                    style={{
                                      backgroundColor: '#f1f5f9',
                                      border: '1px solid #cbd5e1',
                                      borderRadius: '4px',
                                      padding: '0.25rem 0.5rem',
                                      cursor: 'pointer',
                                      color: 'var(--color-danger)',
                                      fontWeight: '700',
                                      fontSize: '0.85rem'
                                    }}
                                    onClick={() => handleClearRow(idx)}
                                  >
                                    초기화
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="action-row-compact">
                      <button className="btn-add-row" onClick={handleAddRows}>
                        ➕ 표 입력 줄 10개 더 추가하기
                      </button>
                      
                      <span style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-muted)' }}>
                        현재 등록 가능한 사원: <strong style={{ color: 'var(--color-success)', fontSize: '1.1rem' }}>{verifiedCount}명</strong>
                      </span>
                    </div>

                    {isOver && (
                      <div className="employee-error-box" style={{ marginBottom: '0.5rem', padding: '0.5rem 0.8rem', fontSize: '0.9rem' }}>
                        ⚠️ <strong>신청 가능 정원 초과:</strong> 등록 가능한 남은 자리는 <strong>{maxLimit - currentRegCount}명</strong>인데 표에 완료된 인원은 <strong>{verifiedCount}명</strong>입니다.
                      </div>
                    )}

                    <button
                      className="btn-submit-compact"
                      disabled={verifiedCount === 0 || isOver || submittingBulk}
                      onClick={handleBulkSubmit}
                    >
                      {submittingBulk 
                        ? '예약 데이터 일괄 전송 중...' 
                        : `📅 [총 ${verifiedCount}명] 교육 신청 일괄 등록 완료`
                      }
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom Panel: Registered List */}
          <div className="portal-bottom-panel">
            <div className="panel-header-row">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                <h3 style={{ fontSize: '1.15rem', color: 'var(--text-main)', fontWeight: '800', margin: 0 }}>
                  📋 내가 소속된 센터의 구성원 교육 예약 목록 ({filteredRegs.length}건)
                </h3>
                <span style={{ color: 'var(--color-primary-dark)', fontSize: '0.85rem', fontWeight: '700' }}>
                  ※ 리더님과 동일한 부서 소속인 경우, 다른 리더나 운영진이 변경/등록한 정보도 안전하게 실시간 조회됩니다!
                </span>
              </div>
              <button
                className="btn-save-compact"
                disabled={unsavedCount === 0 || savingBulkUpdates}
                onClick={handleBulkSaveUpdates}
              >
                💾 변경사항 일괄 저장 ({unsavedCount}건)
              </button>
            </div>

            {/* Real-time Filters */}
            <div className="filters-container-compact">
              <strong style={{ fontSize: '0.9rem', color: 'var(--color-primary-dark)', whiteSpace: 'nowrap' }}>
                🔍 필터링:
              </strong>
              
              <select
                className="filter-select-compact"
                value={filterSession}
                onChange={e => setFilterSession(e.target.value)}
              >
                <option value="ALL">전체 차수 조회</option>
                {schedules.map(sch => (
                  <option key={sch.date_id} value={sch.date_id}>
                    {getDynamicTitle(sch, schedules)}
                  </option>
                ))}
              </select>

              <input
                type="text"
                className="filter-input-compact"
                placeholder="이름, 사번, 연락처, 부서, 직급 실시간 검색..."
                value={filterQuery}
                onChange={e => setFilterQuery(e.target.value)}
              />
            </div>
            
            {/* List Table */}
            <div className="table-container-compact">
              {filteredRegs.length === 0 ? (
                <div className="empty-message-compact">
                  조건에 일치하는 신청 내역이 없습니다.
                </div>
              ) : (
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th className="col-session">차수 (수정 시 우측 일괄저장 클릭)</th>
                      <th className="col-name">성명</th>
                      <th className="col-empid">사번</th>
                      <th className="col-phone">연락처</th>
                      <th className="col-gender">성별</th>
                      <th className="col-position">직급</th>
                      <th className="col-department">부서</th>
                      <th className="col-time">등록시간</th>
                      <th className="col-action" style={{ textAlign: 'center' }}>취소</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRegs.map(reg => {
                      const currentValue = pendingUpdates[reg.reg_id] !== undefined ? pendingUpdates[reg.reg_id] : reg.date_id;
                      const isModified = currentValue !== reg.date_id;
                      
                      return (
                        <tr key={reg.reg_id}>
                          <td>
                            <select 
                              style={{
                                padding: '0.25rem 0.4rem',
                                border: isModified ? '2px solid var(--color-primary-light)' : '1px solid var(--border-color)',
                                borderRadius: '5px',
                                fontWeight: '800',
                                fontSize: '0.9rem',
                                backgroundColor: isModified ? '#eff6ff' : '#ffffff',
                                color: isModified ? 'var(--color-primary-light)' : 'var(--text-main)',
                                outline: 'none',
                                cursor: 'pointer'
                              }}
                              value={currentValue} 
                              onChange={e => {
                                const newDateId = Number(e.target.value);
                                setPendingUpdates({
                                  ...pendingUpdates,
                                  [reg.reg_id]: newDateId
                                });
                              }}
                            >
                              {schedules.map(sch => (
                                <option key={sch.date_id} value={sch.date_id}>
                                  {getDynamicTitle(sch, schedules)}
                                </option>
                              ))}
                            </select>
                            {isModified && (
                              <span style={{
                                display: 'inline-block',
                                marginLeft: '0.3rem',
                                padding: '0.05rem 0.25rem',
                                borderRadius: '3px',
                                fontSize: '0.7rem',
                                backgroundColor: '#eff6ff',
                                color: 'var(--color-primary-light)',
                                fontWeight: '800'
                              }}>
                                수정됨
                              </span>
                            )}
                          </td>

                          <td style={{ color: 'var(--text-main)', fontWeight: '700' }}>{reg.emp_name}</td>
                          <td><strong>{reg.emp_id}</strong></td>
                          <td style={{ letterSpacing: '0.02em' }}>{reg.emp_phone || '-'}</td>
                          <td>{reg.emp_gender}</td>
                          <td>{reg.emp_position}</td>
                          <td>{reg.emp_dept}</td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            {new Date(reg.registered_at).toLocaleString('ko-KR')}
                          </td>
                          
                          <td style={{ textAlign: 'center' }}>
                            <button 
                              className="huge-btn-danger"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem', border: 'none', borderRadius: '5px', cursor: 'pointer', color: 'white' }}
                              onClick={() => handleCancelRegistration(reg.reg_id, reg.emp_name)}
                            >
                              취소
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          
        </section>
      </div>
    </div>
  );
}

// ==========================================
// 3. ADMIN DASHBOARD COMPONENT (EXCEL LOOK-AND-FEEL, STATS REMOVED)
// ==========================================
function AdminDashboard({ user, triggerAlert, showConfirm }) {
  const [activeTab, setActiveTab] = useState('REG'); 
  const [registrations, setRegistrations] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Add Session Form
  const [newDate, setNewDate] = useState('');
  const [newCapacity, setNewCapacity] = useState('60');
  const [newRegion, setNewRegion] = useState('수도권'); // region state
  const [creatingSched, setCreatingSched] = useState(false);

  // Multi-select bulk delete for schedules
  const [selectedSchedules, setSelectedSchedules] = useState(new Set());

  // Dynamic schedule title formatter based on chronological date sorted order within region
  const getDynamicTitle = (sch, allSchedules) => {
    if (!sch) return '';
    const region = sch.region || '수도권';
    const sorted = [...allSchedules]
      .filter(s => (s.region || '수도권') === region)
      .sort((a, b) => a.training_date.localeCompare(b.training_date));
    const idx = sorted.findIndex(s => s.date_id === sch.date_id);
    const mmdd = sch.training_date.split('-').slice(1).join('.');
    return `${idx !== -1 ? idx + 1 : 1}차수 (${mmdd})`;
  };

  const fetchData = async () => {
    try {
      const [regData, schedData] = await Promise.all([
        customFetch(`${API_BASE}/registration`),
        customFetch(`${API_BASE}/schedule`)
      ]);

      // Sort schedules chronologically
      const sortedSchedules = [...schedData].sort((a, b) => a.training_date.localeCompare(b.training_date));

      setRegistrations(regData);
      setSchedules(sortedSchedules);
    } catch (error) {
      console.error('Admin fetch error:', error);
      triggerAlert('danger', error.message || '데이터 로드 실패');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateSchedule = async (e) => {
    e.preventDefault();
    if (!newDate) {
      triggerAlert('danger', '일정 날짜를 입력하세요.');
      return;
    }

    // Flexible 8-digit date formatting (e.g. 20261109 -> 2026-11-09)
    let formattedDate = newDate.trim();
    if (/^\d{8}$/.test(formattedDate)) {
      formattedDate = formattedDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    }

    setCreatingSched(true);
    try {
      await customFetch(`${API_BASE}/schedule`, {
        method: 'POST',
        body: {
          training_date: formattedDate,
          title: '', // Backend will auto-generate title (MM.DD)
          max_capacity: parseInt(newCapacity) || 60,
          region: newRegion
        }
      });

      triggerAlert('success', '새로운 교육 차수 일정이 생성되었습니다.');
      setNewDate('');
      setNewCapacity('60');
      setNewRegion('수도권');
      fetchData();
    } catch (error) {
      triggerAlert('danger', error.message);
    } finally {
      setCreatingSched(false);
    }
  };

  const handleDeleteSchedule = async (dateId, title) => {
    const ok = await showConfirm(`[${title}] 교육 일정을 정말 삭제하시겠습니까? 신청된 모든 대상자 정보가 함께 취소됩니다.`);
    if (!ok) return;

    try {
      await customFetch(`${API_BASE}/schedule/${dateId}`, {
        method: 'DELETE'
      });

      triggerAlert('success', '교육 일정이 정상 삭제되었습니다.');
      
      const updatedSelected = new Set(selectedSchedules);
      updatedSelected.delete(dateId);
      setSelectedSchedules(updatedSelected);

      fetchData();
    } catch (error) {
      triggerAlert('danger', error.message);
    }
  };

  const handleBulkDeleteSchedules = async () => {
    if (selectedSchedules.size === 0) return;
    const ok = await showConfirm(`선택하신 ${selectedSchedules.size}개의 교육 차수를 일괄 삭제하시겠습니까? 신청된 모든 대상자 예약 내역도 함께 취소됩니다.`);
    if (!ok) return;

    try {
      await customFetch(`${API_BASE}/schedule/bulk-delete`, {
        method: 'POST',
        body: { date_ids: Array.from(selectedSchedules) }
      });

      triggerAlert('success', `${selectedSchedules.size}개의 교육 차수가 정상적으로 일괄 삭제되었습니다.`);
      setSelectedSchedules(new Set());
      fetchData();
    } catch (error) {
      triggerAlert('danger', error.message);
    }
  };

  const handleUpdateScheduleStatus = async (dateId, currentStatus) => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
    try {
      await customFetch(`${API_BASE}/schedule/${dateId}`, {
        method: 'PUT',
        body: { status: nextStatus }
      });

      triggerAlert('success', `교육 차정이 ${nextStatus === 'ACTIVE' ? '접수중' : '마감'} 처리되었습니다.`);
      fetchData();
    } catch (error) {
      triggerAlert('danger', error.message);
    }
  };

  const handleCancelRegistration = async (regId, empName) => {
    const ok = await showConfirm(`운영진 권한으로 [${empName}] 사원의 교육 예약을 강제 취소하겠습니까?`);
    if (!ok) return;

    try {
      await customFetch(`${API_BASE}/registration/${regId}`, {
        method: 'DELETE'
      });

      triggerAlert('success', '강제 취소 완료되었습니다.');
      fetchData();
    } catch (error) {
      triggerAlert('danger', error.message);
    }
  };

  const handleExportCSV = () => {
    if (registrations.length === 0) {
      triggerAlert('danger', '내보낼 예약 데이터가 없습니다.');
      return;
    }

    const escapeCSV = (val) => {
      const str = String(val ?? '');
      return str.includes(',') || str.includes('"') || str.includes('\n')
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    let csvContent = '\uFEFF';
    csvContent += '차수,이름,사번,연락처,성별,직급,부서,등록리더,등록시간\r\n';

    registrations.forEach(r => {
      const sch = schedules.find(s => s.date_id === r.date_id);
      const displayTitle = sch ? getDynamicTitle(sch, schedules) : r.training_title;
      const row = [
        displayTitle,
        r.emp_name,
        r.emp_id,
        r.emp_phone || '',
        r.emp_gender,
        r.emp_position,
        r.emp_dept,
        r.leader_name || '',
        r.registered_at
      ].map(escapeCSV).join(',');
      csvContent += row + '\r\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `직무교육_차수종합신청명단_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredRegs = registrations.filter(r => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    const sch = schedules.find(s => s.date_id === r.date_id);
    const displayTitle = (sch ? getDynamicTitle(sch, schedules) : r.training_title).toLowerCase();
    return (
      r.emp_name.toLowerCase().includes(q) ||
      r.emp_id.includes(q) ||
      displayTitle.includes(q) ||
      (r.leader_name && r.leader_name.toLowerCase().includes(q))
    );
  });

  if (loading) {
    return <div style={{ fontSize: '1.3rem', textAlign: 'center', padding: '3rem' }}>데이터 조회 중...</div>;
  }

  return (
    <div className="admin-split-layout" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* Top action header */}
      <div className="admin-header-row">
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: '800', margin: 0 }}>🛠️ 운영진 종합 관리 대시보드 (차수 종합뷰)</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.1rem' }}>
            차수별 교육 현황을 엑셀과 완벽히 매칭하여 관리하고, 원클릭으로 엑셀 통합 시트 형태로 즉시 다운로드하세요.
          </p>
        </div>
        <button className="btn-csv-download" onClick={handleExportCSV}>
          📥 통합 명단 엑셀(CSV) 다운로드
        </button>
      </div>

      {/* Tabs */}
      <div className="admin-tabs-container">
        <button className={`admin-tab-btn ${activeTab === 'REG' ? 'active' : ''}`} onClick={() => setActiveTab('REG')}>
          👥 통합 실시간 예약 현황 ({filteredRegs.length}건)
        </button>
        <button className={`admin-tab-btn ${activeTab === 'SCHED' ? 'active' : ''}`} onClick={() => setActiveTab('SCHED')}>
          📅 차수 일정 및 마감 정원제한 ({schedules.length}개 차수)
        </button>
      </div>

      {/* Panel Contents */}
      <div className="admin-panel-content">
        
        {/* TAB 1: INTEGRATED REGISTRATIONS */}
        {activeTab === 'REG' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className="filters-container-compact" style={{ padding: '0.4rem 0.8rem', marginBottom: '0.6rem' }}>
              <input
                className="filter-input-compact"
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.95rem' }}
                type="text"
                placeholder="사원명, 사번, 차수로 실시간 빠른 검색..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="table-container-compact" style={{ flex: 1 }}>
              {filteredRegs.length === 0 ? (
                <div className="empty-message-compact">
                  등록된 교육 참가 내역이 없습니다.
                </div>
              ) : (
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th className="col-session">차수</th>
                      <th className="col-name">이름</th>
                      <th className="col-empid">사번</th>
                      <th className="col-phone">연락처</th>
                      <th className="col-gender">성별</th>
                      <th className="col-position">직급</th>
                      <th className="col-department">부서</th>
                      <th className="col-leader">등록 리더</th>
                      <th className="col-action" style={{ textAlign: 'center' }}>취소</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRegs.map(r => (
                      <tr key={r.reg_id}>
                        <td style={{ color: 'var(--color-primary)', fontWeight: '800' }}>
                          {(() => {
                            const sch = schedules.find(s => s.date_id === r.date_id);
                            return sch ? getDynamicTitle(sch, schedules) : r.training_title;
                          })()}
                        </td>
                        <td style={{ color: 'var(--text-main)', fontWeight: '700' }}>{r.emp_name}</td>
                        <td><strong>{r.emp_id}</strong></td>
                        <td style={{ letterSpacing: '0.02em' }}>{r.emp_phone || '-'}</td>
                        <td>{r.emp_gender}</td>
                        <td>{r.emp_position}</td>
                        <td>{r.emp_dept}</td>
                        <td>
                          <strong style={{ color: 'var(--color-accent)' }}>{r.leader_name || '관리자'}</strong>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>
                            {r.leader_dept || ''}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button 
                            className="huge-btn-danger"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem', border: 'none', borderRadius: '5px', cursor: 'pointer', color: 'white' }}
                            onClick={() => handleCancelRegistration(r.reg_id, r.emp_name)}
                          >
                            강제 취소
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: SCHEDULE CREATION */}
        {activeTab === 'SCHED' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', gap: '0.8rem' }}>
            
            {/* Add Session Form */}
            <div style={{ backgroundColor: '#f8fafc', padding: '0.8rem 1.2rem', borderRadius: '8px', border: '2px solid var(--border-color)', flexShrink: 0 }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.6rem', fontWeight: '800' }}>
                ➕ 신규 교육 차수 추가
              </h3>
              
              <form onSubmit={handleCreateSchedule} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '1rem', alignItems: 'end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>차수 교육 날짜</label>
                  <input
                    className="filter-input-compact"
                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.95rem' }}
                    type="text"
                    placeholder="2026-11-09 또는 20261109"
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>차수 지역 구분</label>
                  <select
                    className="filter-select-compact"
                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.95rem', width: '100%' }}
                    value={newRegion}
                    onChange={e => setNewRegion(e.target.value)}
                  >
                    <option value="수도권">수도권</option>
                    <option value="중부&강원실">중부&강원실</option>
                    <option value="서부&충청실">서부&충청실</option>
                    <option value="남부">남부</option>
                  </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>차수 정원 제한</label>
                  <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <input
                      className="filter-input-compact"
                      style={{ padding: '0.4rem 0.6rem', fontSize: '0.95rem', width: '80px' }}
                      type="number"
                      min="1"
                      value={newCapacity}
                      onChange={e => setNewCapacity(e.target.value)}
                    />
                    <button className="btn-save-compact" type="submit" disabled={creatingSched} style={{ flex: 1, padding: '0.4rem' }}>
                      {creatingSched ? '생성 중...' : '차수 개설 📅'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* List of Sessions */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '1rem', color: 'var(--text-main)', margin: 0, fontWeight: '800' }}>
                  📋 각 차수별 신청 접수 상황 및 정원 제어
                </h3>
                {selectedSchedules.size > 0 && (
                  <button
                    onClick={handleBulkDeleteSchedules}
                    className="huge-btn-danger"
                    style={{
                      padding: '0.35rem 0.8rem',
                      fontSize: '0.85rem',
                      fontWeight: '800',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      color: 'white',
                      backgroundColor: 'var(--color-danger)',
                      boxShadow: '0 4px 10px rgba(220, 38, 38, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.2rem'
                    }}
                  >
                    🗑️ 선택한 차수 일괄 삭제 ({selectedSchedules.size}개)
                  </button>
                )}
              </div>
              
              <div className="table-container-compact" style={{ flex: 1 }}>
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          style={{ cursor: 'pointer' }}
                          checked={schedules.length > 0 && selectedSchedules.size === schedules.length}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedSchedules(new Set(schedules.map(s => s.date_id)));
                            } else {
                              setSelectedSchedules(new Set());
                            }
                          }}
                        />
                      </th>
                      <th>지역</th>
                      <th>차수</th>
                      <th>교육 날짜</th>
                      <th>예약 현황</th>
                      <th>상태 강제 조정</th>
                      <th style={{ textAlign: 'center' }}>삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map(sch => {
                      const regCount = sch.current_count || 0;
                      const maxCap = sch.max_capacity || 60;
                      const dynamicTitle = getDynamicTitle(sch, schedules);
                      const isChecked = selectedSchedules.has(sch.date_id);
                      
                      return (
                        <tr key={sch.date_id} style={{ backgroundColor: isChecked ? '#f1f5f9' : 'transparent' }}>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              style={{ cursor: 'pointer' }}
                              checked={isChecked}
                              onChange={() => {
                                const next = new Set(selectedSchedules);
                                if (next.has(sch.date_id)) {
                                  next.delete(sch.date_id);
                                } else {
                                  next.add(sch.date_id);
                                }
                                setSelectedSchedules(next);
                              }}
                            />
                          </td>
                          <td>
                            <span style={{
                              padding: '0.15rem 0.5rem',
                              borderRadius: '6px',
                              fontSize: '0.8rem',
                              fontWeight: '800',
                              backgroundColor: sch.region === '남부' ? '#ffe4e6' :
                                             sch.region === '서부&충청실' ? '#fef3c7' :
                                             sch.region === '중부&강원실' ? '#dcfce7' : '#e0f2fe',
                              color: sch.region === '남부' ? '#b91c1c' :
                                     sch.region === '서부&충청실' ? '#d97706' :
                                     sch.region === '중부&강원실' ? '#15803d' : '#0369a1'
                            }}>
                              {sch.region || '수도권'}
                            </span>
                          </td>
                          <td style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--color-primary)' }}>{dynamicTitle}</td>
                          <td style={{ fontWeight: '700' }}>{sch.training_date}</td>
                          <td>
                            <span style={{ fontSize: '1.05rem', fontWeight: '800', color: regCount >= maxCap ? 'var(--color-danger)' : 'var(--color-success)' }}>
                              {regCount}명
                            </span>
                            <span> / {maxCap}명 정원</span>
                            {regCount >= maxCap && <span style={{ marginLeft: '0.4rem', color: 'var(--color-danger)', fontWeight: '700' }}>(🔒 자동 마감)</span>}
                          </td>
                          <td>
                            <button
                              onClick={() => handleUpdateScheduleStatus(sch.date_id, sch.status)}
                              style={{
                                padding: '0.25rem 0.6rem',
                                fontSize: '0.85rem',
                                fontWeight: '700',
                                border: 'none',
                                borderRadius: '15px',
                                cursor: 'pointer',
                                backgroundColor: sch.status === 'ACTIVE' && regCount < maxCap ? '#dcfce7' : '#fee2e2',
                                color: sch.status === 'ACTIVE' && regCount < maxCap ? '#15803d' : '#b91c1c'
                              }}
                            >
                              {sch.status === 'ACTIVE' && regCount < maxCap ? '✅ 접수중 (강제마감)' : '❌ 마감됨 (접수전환)'}
                            </button>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button 
                              className="huge-btn-danger"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.85rem', border: 'none', borderRadius: '5px', cursor: 'pointer', color: 'white' }}
                              onClick={() => handleDeleteSchedule(sch.date_id, dynamicTitle)}
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
