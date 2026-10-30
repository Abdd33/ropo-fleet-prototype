import React, { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App, Button, ConfigProvider, DatePicker, Input, Segmented, Select, Tooltip, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import './antd-ui.css';

dayjs.locale('zh-cn');
const F = window.Fleet;
const fleetTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#4389ff',
    colorSuccess: '#10bd8e',
    colorWarning: '#ffb300',
    colorError: '#f44d5b',
    colorBgBase: '#0e121b',
    colorBgContainer: '#1b202b',
    colorBgElevated: '#252d3c',
    colorText: '#dce1ee',
    colorTextSecondary: '#a0aec4',
    colorBorder: '#354158',
    borderRadius: 4,
    controlHeight: 34,
    fontSize: 13,
    fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", Arial, sans-serif',
    zIndexPopupBase: 1200,
  },
};

function Provider({ children }) {
  return <ConfigProvider prefixCls="fleet-ant" locale={zhCN} theme={fleetTheme}>{children}</ConfigProvider>;
}

function Icon({ name }) {
  const paths = {
    search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1',
    flow: 'M4 4h6v6H4zm10 10h6v6h-6zM7 10v7h7',
    plus: 'M12 5v14M5 12h14',
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function ScheduleControls({ initial, types, statuses, onChange, onCurrent }) {
  const [model, setModel] = useState(initial);
  const update = (patch) => {
    setModel(current => ({ ...current, ...patch }));
    onChange(patch);
  };
  const reset = () => {
    update({ date: '2026-10-23', range: 'today', type: 'all', status: 'all', query: '', resetTime: true });
    F.toast('已恢复场景日期、当前时间并清除筛选');
  };
  return <div className="fleet-ui">
    <div className="page-head fleet-schedule-heading">
      <h1>任务与调度</h1>
      <div className="fleet-schedule-actions">
        <Button href="#automation" icon={<Icon name="flow" />}>自动化流程</Button>
        <Segmented aria-label="调度视图" value={model.view} onChange={view => update({ view })} options={[
          { label: '时间轴', value: 'timeline' }, { label: '任务清单', value: 'list' },
        ]} />
        <Button type="primary" href="#create" icon={<Icon name="plus" />}>创建运行计划</Button>
      </div>
    </div>
    <div className="fleet-schedule-toolbar">
      <div className="fleet-toolbar-group">
        <DatePicker id="dispatch-antd-date" aria-label="计划日期" value={dayjs(model.date)}
          format="YYYY/MM/DD" allowClear={false} showNow={false}
          onChange={value => value && update({ date: value.format('YYYY-MM-DD') })} />
        <Segmented aria-label="时间范围" value={model.range} onChange={range => update({ range })} options={[
          { label: '今天', value: 'today' }, { label: '未来24h', value: '24h' }, { label: '近3天', value: '3days' },
        ]} />
        <Tooltip title="回到场景当前时间 10:20"><Button size="small" onClick={onCurrent}>回到当前</Button></Tooltip>
      </div>
      <div className="fleet-toolbar-group fleet-toolbar-filters">
        <Select id="dispatch-antd-type" aria-label="计划类型" className="fleet-type-filter" value={model.type}
          options={[{ value: 'all', label: '类型：全部' }, ...types.map(value => ({ value, label: value }))]}
          onChange={type => update({ type })} />
        <Select id="dispatch-antd-status" aria-label="计划状态" className="fleet-status-filter" value={model.status}
          options={[{ value: 'all', label: '状态：全部' }, ...statuses]}
          onChange={status => update({ status })} />
        <Input id="dispatch-antd-search" aria-label="搜索计划或车辆" className="fleet-plan-search" placeholder="搜索车辆 / 计划"
          prefix={<Icon name="search" />} allowClear value={model.query} onChange={event => update({ query: event.target.value })} />
        <Tooltip title="清除筛选并恢复场景时间"><Button aria-label="清除筛选" icon={<Icon name="refresh" />} onClick={reset} /></Tooltip>
      </div>
    </div>
  </div>;
}

function FeedbackBridge() {
  const { message, modal } = App.useApp();
  useLayoutEffect(() => {
    const previousToast = F.toast, previousConfirm = F.confirm;
    F.toast = (content, type = 'success') => message.open({
      content,
      type: ['success', 'warning', 'error', 'info', 'loading'].includes(type) ? type : 'info',
      duration: 4,
    });
    F.confirm = (title, content, action, okText = '确认') => modal.confirm({
      title, content, okText, cancelText: '取消', centered: true,
      maskClosable: false,
      onOk: async close => { if (await action?.() !== false) close(); },
    });
    return () => { F.toast = previousToast; F.confirm = previousConfirm; };
  }, [message, modal]);
  return null;
}

F.ui = {
  mountSchedule(element, props) {
    const root = createRoot(element);
    flushSync(() => root.render(<Provider><ScheduleControls {...props} /></Provider>));
    return () => root.unmount();
  },
};

const feedbackHost = document.createElement('div');
feedbackHost.id = 'fleet-feedback';
document.body.append(feedbackHost);
const feedbackRoot = createRoot(feedbackHost);
flushSync(() => feedbackRoot.render(<Provider><App message={{ maxCount: 3, top: 76 }}><FeedbackBridge /></App></Provider>));
