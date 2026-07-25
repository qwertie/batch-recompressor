import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { setup, styled, glob } from './styled.js';
import React from 'react';
import { ViewModel } from './viewmodel.js';
import { Tree } from './components/Tree.js';
import { DetailPage } from './components/DetailPage.js';

setup(React.createElement);

glob`
  body {
    margin: 0; background: #1e1e1e; color: #ddd;
    font: 14px/1.45 system-ui, sans-serif;
  }
  input, select, button {
    background: #2a2a2a; color: #ddd; border: 1px solid #555; border-radius: 4px;
  }
  h2 { margin: 4px 0 12px; } h3 { margin: 16px 0 6px; color: #9cc; }
`;

const Layout = styled('div')`display: flex; height: 100vh;`;
const Sidebar = styled('div')`
  width: 380px; min-width: 240px; overflow: auto; padding: 10px;
  border-right: 1px solid #333; resize: horizontal;
`;

export const App = observer(function App(props: { vm?: ViewModel }) {
  const vm = useMemo(() => props.vm ?? new ViewModel(), [props.vm]);
  useEffect(() => {
    if (typeof EventSource !== 'undefined') vm.connectEvents();
  }, [vm]);
  return <Layout>
    <Sidebar><Tree vm={vm} /></Sidebar>
    <DetailPage vm={vm} />
  </Layout>;
});
